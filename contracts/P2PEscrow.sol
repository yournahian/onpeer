// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title P2PEscrow
/// @notice Fee-free USDC escrow for off-chain fiat trades; governance cannot withdraw escrow.
/// @dev Pass Arc's six-decimal ERC-20 USDC view, 0x3600000000000000000000000000000000000000.
///      No native currency is accepted. Fiat payment is attested by users, not verified on-chain.
///      Payment details are public on-chain: never include secrets or sensitive personal data.
contract P2PEscrow is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint8 public constant MAX_CANCEL_STRIKES = 3;
    uint256 public constant STRIKE_WINDOW = 24 hours;
    uint256 public constant COOLDOWN = 24 hours;
    uint32 public constant MAX_DISPUTES_LOST = 3;
    uint256 public constant NEW_TAKER_MAX = 200e6;
    uint256 public constant QUALIFY_MIN = 10e6;
    uint256 public constant MERCHANT_MARGIN = 100e6;
    uint256 public constant MARGIN_WITHDRAW_DELAY = 7 days;
    uint256 public constant MESSAGE_MAX = 280;

    enum Side { Sell, Buy }
    enum OrderStatus {
        None, Pending, Paid, Completed, Cancelled, Disputed,
        ResolvedToBuyer, ResolvedToSeller
    }

    struct Ad {
        address maker;
        Side side;
        bytes3 currency;
        bool paused;
        bool closed;
        uint64 createdAt;
        uint32 paymentMask;
        uint16 windowMinutes;
        uint128 priceE6;
        uint128 minAmount;
        uint128 maxAmount;
        uint128 available;
        uint128 initialAmount;
        string details;
        uint32 minTakerCompleted;
        bool merchantAd;
    }

    struct Order {
        uint256 adId;
        address buyer;
        address seller;
        bytes3 currency;
        OrderStatus status;
        uint32 paymentMask;
        uint64 createdAt;
        uint64 deadline;
        uint64 paidAt;
        uint64 disputedAt;
        uint128 amount;
        uint128 priceE6;
        uint256 fiatAmountE6;
        string paymentDetails;
        address taker;
    }

    /// @notice ordersCompleted counts releases of at least QUALIFY_MIN with distinct counterparties.
    /// @dev Each unordered pair counts once for both parties. Further Sybil resistance cannot be
    ///      achieved onchain; the arbiter or owner can restrict addresses.
    struct Stats {
        uint32 ordersCreated;
        uint32 ordersCompleted;
        uint32 disputesLost;
        uint128 volume;
    }

    /// @notice Rolling buyer cancellation strikes and temporary entry ban.
    struct Penalty {
        uint64 windowStart;
        uint64 bannedUntil;
        uint8 strikes;
    }

    /// @notice A single delayed withdrawal request, still subject to dispute slashing.
    struct MarginWithdrawal {
        uint128 amount;
        uint64 unlockAt;
    }

    /// @notice Combined trading, safety, margin and deferred-payout information.
    struct AccountView {
        uint32 ordersCreated;
        uint32 ordersCompleted;
        uint32 disputesLost;
        uint128 volume;
        uint256 margin;
        uint256 effectiveMargin;
        uint256 pendingWithdrawal;
        uint64 withdrawalUnlockAt;
        bool merchant;
        bool restricted;
        uint64 bannedUntil;
        uint8 strikes;
        uint256 partyOpen;
        uint256 claimable;
    }

    mapping(address => bool) public restricted;
    mapping(address => Penalty) public penalties;
    mapping(address => uint256) public margin;
    mapping(address => MarginWithdrawal) public marginWithdrawal;
    mapping(address => uint256) public partyOpenOrders;

    IERC20 public immutable usdc;
    address public arbiter;
    uint256 public adCount;
    uint256 public orderCount;
    mapping(bytes3 => bool) public supportedCurrency;
    mapping(address => uint256) public openOrderCount;
    mapping(address => Stats) public stats;
    mapping(uint256 => Ad) private _ads;
    mapping(uint256 => Order) private _orders;
    mapping(address => uint256[]) private _userOrderIds;
    mapping(address => uint256[]) private _userAdIds;
    mapping(address => uint256) public claimable;
    mapping(bytes32 => bool) public pairCounted;

    error InvalidAddress();
    error UnsupportedCurrency(bytes3 currency);
    error InvalidPrice();
    error InvalidAmount();
    error InvalidPaymentMask();
    error InvalidWindow();
    error InvalidDetails();
    error AdNotFound(uint256 adId);
    error OrderNotFound(uint256 orderId);
    error Unauthorized();
    error AdUnavailable();
    error SelfTrade();
    error OpenOrderLimit(address account);
    error InvalidStatus(OrderStatus status);
    error DeadlinePassed();
    error TooEarly();
    error ArbiterIsParty();
    error PriceMoved();
    error NothingToWithdraw();
    error NotAdmin();
    error Restricted();
    error CooldownActive();
    error RequirementNotMet();
    error NewUserLimit();
    error WithdrawalPending();
    error OpenOrdersRemain();
    error InvalidMessage();
    error InvalidSide();
    error MerchantMarginTooLow();
    error RenounceDisabled();

    event RestrictionUpdated(address indexed account, bool restricted);
    event StrikeAdded(address indexed buyer, uint8 strikes);
    event CooldownStarted(address indexed buyer, uint64 bannedUntil);
    event MarginDeposited(address indexed account, uint256 amount);
    event MarginWithdrawalRequested(address indexed account, uint128 amount, uint64 unlockAt);
    event MarginWithdrawalCancelled(address indexed account, uint128 amount);
    event MarginWithdrawn(address indexed account, uint256 amount);
    event MarginSlashed(uint256 indexed orderId, address indexed loser, address indexed winner, uint256 amount);
    event OrderMessage(uint256 indexed orderId, address indexed sender, string text);

    event AdCreated(uint256 indexed adId, address indexed maker, Side side, bytes3 currency, uint128 totalAmount);
    event AdPriceUpdated(uint256 indexed adId, uint128 oldPriceE6, uint128 newPriceE6);
    event AdPaused(uint256 indexed adId, bool paused);
    event AdClosed(uint256 indexed adId, uint128 remaining, uint128 refunded);
    event OrderOpened(uint256 indexed orderId, uint256 indexed adId, address indexed buyer, address seller, uint128 amount);
    event OrderPaid(uint256 indexed orderId, uint64 paidAt);
    event OrderReleased(uint256 indexed orderId, address indexed buyer, uint128 amount);
    event OrderCancelled(uint256 indexed orderId, address indexed caller);
    event OrderDisputed(uint256 indexed orderId, address indexed caller, uint64 disputedAt);
    event DisputeResolved(uint256 indexed orderId, bool toBuyer, address indexed recipient, uint128 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event PayoutDeferred(address indexed to, uint256 amount);
    event ArbiterUpdated(address indexed oldArbiter, address indexed newArbiter);
    event CurrencyUpdated(bytes3 indexed currency, bool supported);

    /// @param usdc_ Six-decimal Arc USDC ERC-20 address (not the native-currency interface).
    /// @param initialOwner Governance address, with two-step ownership transfers.
    /// @param initialArbiter Initial dispute resolver; cannot resolve its own trades.
    constructor(address usdc_, address initialOwner, address initialArbiter) Ownable(initialOwner) {
        if (usdc_ == address(0) || usdc_.code.length == 0 || initialArbiter == address(0)) {
            revert InvalidAddress();
        }
        usdc = IERC20(usdc_);
        arbiter = initialArbiter;
        emit ArbiterUpdated(address(0), initialArbiter);
        _setCurrency("INR", true);
        _setCurrency("PKR", true);
        _setCurrency("BDT", true);
        _setCurrency("LKR", true);
        _setCurrency("NPR", true);
        _setCurrency("BTN", true);
        _setCurrency("MVR", true);
        _setCurrency("AFN", true);
    }

    /// @notice Create an ad. Sell ads deposit USDC; Buy ads reserve buying capacity only.
    /// @dev Amounts use six USDC decimals; priceE6 is fiat per USDC scaled by 1e6.
    ///      Merchant status is fixed on the ad at creation. Margin withdrawal that drops effective
    ///      margin below MERCHANT_MARGIN makes merchant-flagged ads unfillable until re-funded.
    function createAd(
        uint8 side,
        bytes3 currency,
        uint128 priceE6,
        uint128 totalAmount,
        uint128 minAmount,
        uint128 maxAmount,
        uint32 paymentMask,
        uint16 windowMinutes,
        uint32 minTakerCompleted,
        string calldata details
    ) external nonReentrant whenNotPaused returns (uint256 adId) {
        _requireEligible(msg.sender);
        if (side > uint8(Side.Buy)) revert InvalidSide();
        if (!supportedCurrency[currency]) revert UnsupportedCurrency(currency);
        _validatePrice(priceE6);
        if (minAmount == 0 || minAmount > maxAmount || maxAmount > totalAmount) revert InvalidAmount();
        if (paymentMask == 0) revert InvalidPaymentMask();
        if (windowMinutes < 10 || windowMinutes > 1440) revert InvalidWindow();
        if (bytes(details).length > 200 || (side == uint8(Side.Sell) && bytes(details).length == 0)) {
            revert InvalidDetails();
        }

        adId = ++adCount;
        Ad storage ad = _ads[adId];
        ad.maker = msg.sender;
        ad.side = Side(side);
        ad.currency = currency;
        ad.createdAt = uint64(block.timestamp);
        ad.paymentMask = paymentMask;
        ad.windowMinutes = windowMinutes;
        ad.priceE6 = priceE6;
        ad.minAmount = minAmount;
        ad.maxAmount = maxAmount;
        ad.available = totalAmount;
        ad.initialAmount = totalAmount;
        ad.details = details;
        ad.minTakerCompleted = minTakerCompleted;
        ad.merchantAd = isMerchant(msg.sender);
        _userAdIds[msg.sender].push(adId);
        emit AdCreated(adId, msg.sender, Side(side), currency, totalAmount);
        if (side == uint8(Side.Sell)) usdc.safeTransferFrom(msg.sender, address(this), totalAmount);
    }

    /// @notice Change the price for future orders only.
    function setAdPrice(uint256 adId, uint128 newPriceE6) external {
        Ad storage ad = _makerAd(adId);
        if (ad.closed) revert AdUnavailable();
        _validatePrice(newPriceE6);
        uint128 oldPrice = ad.priceE6;
        ad.priceE6 = newPriceE6;
        emit AdPriceUpdated(adId, oldPrice, newPriceE6);
    }

    /// @notice Pause or resume new orders without affecting existing orders.
    function setAdPaused(uint256 adId, bool paused) external {
        Ad storage ad = _makerAd(adId);
        if (ad.closed) revert AdUnavailable();
        ad.paused = paused;
        emit AdPaused(adId, paused);
    }

    /// @notice Permanently close an ad and refund unreserved Sell inventory.
    function closeAd(uint256 adId) external nonReentrant {
        Ad storage ad = _makerAd(adId);
        if (ad.closed) revert AdUnavailable();
        uint128 remaining = ad.available;
        uint128 refund = ad.side == Side.Sell ? remaining : 0;
        ad.closed = true;
        ad.available = 0;
        emit AdClosed(adId, remaining, refund);
        if (refund != 0) _payout(ad.maker, refund);
    }

    /// @notice Reserve inventory/capacity and open a Pending trade.
    /// @param paymentDetails Seller's fiat receiving details for Buy ads; ignored for Sell ads.
    function openOrder(uint256 adId, uint128 amount, uint128 limitPriceE6, string calldata paymentDetails)
        external nonReentrant whenNotPaused returns (uint256 orderId)
    {
        _requireEligible(msg.sender);
        Ad storage ad = _getAd(adId);
        _requireEligible(ad.maker);
        if (ad.merchantAd && !isMerchant(ad.maker)) revert MerchantMarginTooLow();
        if (stats[msg.sender].ordersCompleted < ad.minTakerCompleted) revert RequirementNotMet();
        if (stats[msg.sender].ordersCompleted == 0 && amount > NEW_TAKER_MAX) revert NewUserLimit();
        if (ad.closed || ad.paused) revert AdUnavailable();
        if (msg.sender == ad.maker) revert SelfTrade();
        if (amount == 0 || amount > ad.available) revert InvalidAmount();
        if (amount > ad.maxAmount || (amount < ad.minAmount && amount != ad.available)) {
            revert InvalidAmount();
        }
        if ((ad.side == Side.Sell && ad.priceE6 > limitPriceE6)
            || (ad.side == Side.Buy && ad.priceE6 < limitPriceE6)) revert PriceMoved();
        if (openOrderCount[msg.sender] >= 5) revert OpenOrderLimit(msg.sender);
        if (ad.side == Side.Buy && (bytes(paymentDetails).length == 0 || bytes(paymentDetails).length > 200)) {
            revert InvalidDetails();
        }

        ad.available -= amount;
        orderId = ++orderCount;
        Order storage order = _orders[orderId];
        order.adId = adId;
        order.buyer = ad.side == Side.Sell ? msg.sender : ad.maker;
        order.seller = ad.side == Side.Sell ? ad.maker : msg.sender;
        order.currency = ad.currency;
        order.status = OrderStatus.Pending;
        order.paymentMask = ad.paymentMask;
        order.createdAt = uint64(block.timestamp);
        order.deadline = uint64(block.timestamp + uint256(ad.windowMinutes) * 60);
        order.amount = amount;
        order.priceE6 = ad.priceE6;
        order.fiatAmountE6 = uint256(amount) * uint256(ad.priceE6) / 1e6;
        if (ad.side == Side.Sell) order.paymentDetails = ad.details;
        else order.paymentDetails = paymentDetails;
        order.taker = msg.sender;
        ++openOrderCount[order.taker];
        ++partyOpenOrders[order.buyer];
        ++partyOpenOrders[order.seller];
        ++stats[order.buyer].ordersCreated;
        ++stats[order.seller].ordersCreated;
        _userOrderIds[order.buyer].push(orderId);
        _userOrderIds[order.seller].push(orderId);
        emit OrderOpened(orderId, adId, order.buyer, order.seller, amount);
        if (ad.side == Side.Buy) usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Buyer attests to sending fiat before the payment deadline (inclusive).
    function markPaid(uint256 orderId) external {
        Order storage order = _getOrder(orderId);
        if (msg.sender != order.buyer) revert Unauthorized();
        _requireStatus(order, OrderStatus.Pending);
        if (block.timestamp > order.deadline) revert DeadlinePassed();
        order.status = OrderStatus.Paid;
        order.paidAt = uint64(block.timestamp);
        emit OrderPaid(orderId, order.paidAt);
    }

    /// @notice Seller releases USDC voluntarily while the order is Pending or Paid.
    /// @dev Once a dispute is open only the arbiter can settle, so a losing seller cannot
    ///      front-run a ruling to dodge dispute-loss counts or margin slashing.
    ///      Only voluntary releases increment completed-order and volume statistics.
    function release(uint256 orderId) external nonReentrant {
        Order storage order = _getOrder(orderId);
        if (msg.sender != order.seller) revert Unauthorized();
        if (order.status != OrderStatus.Pending && order.status != OrderStatus.Paid)
            revert InvalidStatus(order.status);
        _finish(order, OrderStatus.Completed);
        if (order.amount >= QUALIFY_MIN) {
            bytes32 pairKey = order.buyer < order.seller
                ? keccak256(abi.encodePacked(order.buyer, order.seller))
                : keccak256(abi.encodePacked(order.seller, order.buyer));
            if (!pairCounted[pairKey]) {
                pairCounted[pairKey] = true;
                ++stats[order.buyer].ordersCompleted;
                ++stats[order.seller].ordersCompleted;
            }
        }
        stats[order.buyer].volume += order.amount;
        stats[order.seller].volume += order.amount;
        emit OrderReleased(orderId, order.buyer, order.amount);
        _payout(order.buyer, order.amount);
    }

    /// @notice Buyer may cancel Pending orders anytime; anyone may cancel strictly after expiry.
    /// @dev Sellers cannot cancel before expiry; Paid and Disputed orders cannot be cancelled.
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = _getOrder(orderId);
        _requireStatus(order, OrderStatus.Pending);
        if (msg.sender != order.buyer && block.timestamp <= order.deadline) revert Unauthorized();
        Ad storage ad = _ads[order.adId];
        _finish(order, OrderStatus.Cancelled);
        if (order.buyer == order.taker) {
            _addStrike(order.buyer);
        } else if (!ad.closed) {
            ad.paused = true;
            emit AdPaused(order.adId, true);
        }
        if (!ad.closed) ad.available += order.amount;
        emit OrderCancelled(orderId, msg.sender);
        if (ad.side == Side.Buy) _payout(order.seller, order.amount);
        else if (ad.closed) _payout(ad.maker, order.amount);
    }

    /// @notice Seller may dispute Paid orders immediately; buyer must wait fifteen minutes.
    function openDispute(uint256 orderId) external {
        Order storage order = _getOrder(orderId);
        _requireStatus(order, OrderStatus.Paid);
        if (msg.sender != order.seller) {
            if (msg.sender != order.buyer) revert Unauthorized();
            if (block.timestamp < uint256(order.paidAt) + 15 minutes) revert TooEarly();
        }
        order.status = OrderStatus.Disputed;
        order.disputedAt = uint64(block.timestamp);
        emit OrderDisputed(orderId, msg.sender, order.disputedAt);
    }

    /// @notice Arbiter awards the full escrow to a party; lost disputes never replenish inventory.
    /// @dev The owner can replace an inactive arbiter with setArbiter.
    /// @param slashLoser Whether to compensate the winner from the loser's margin, capped at escrow size.
    function resolveDispute(uint256 orderId, bool toBuyer, bool slashLoser) external nonReentrant {
        if (msg.sender != arbiter) revert Unauthorized();
        Order storage order = _getOrder(orderId);
        _requireStatus(order, OrderStatus.Disputed);
        if (msg.sender == order.buyer || msg.sender == order.seller) revert ArbiterIsParty();
        address recipient = toBuyer ? order.buyer : order.seller;
        address loser = toBuyer ? order.seller : order.buyer;
        _finish(order, toBuyer ? OrderStatus.ResolvedToBuyer : OrderStatus.ResolvedToSeller);
        ++stats[loser].disputesLost;
        uint256 slash;
        if (slashLoser) {
            slash = margin[loser] < order.amount ? margin[loser] : order.amount;
            margin[loser] -= slash;
            MarginWithdrawal storage pending = marginWithdrawal[loser];
            if (pending.amount > margin[loser]) pending.amount = uint128(margin[loser]);
            emit MarginSlashed(orderId, loser, recipient, slash);
        }
        emit DisputeResolved(orderId, toBuyer, recipient, order.amount);
        _payout(recipient, order.amount);
        if (slash != 0) _payout(recipient, slash);
    }

    /// @notice Emit a public trade message without persisting its text in storage.
    /// @dev Messages are public; never include secrets or sensitive personal data.
    function postMessage(uint256 orderId, string calldata text) external {
        Order storage order = _getOrder(orderId);
        if (order.status != OrderStatus.Pending && order.status != OrderStatus.Paid
            && order.status != OrderStatus.Disputed) revert InvalidStatus(order.status);
        if (msg.sender != order.buyer && msg.sender != order.seller
            && !(msg.sender == arbiter && order.status == OrderStatus.Disputed)) revert Unauthorized();
        if (bytes(text).length == 0 || bytes(text).length > MESSAGE_MAX) revert InvalidMessage();
        emit OrderMessage(orderId, msg.sender, text);
    }

    /// @notice Deposit six-decimal USDC as slashable security margin, even while paused.
    function depositMargin(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        margin[msg.sender] += amount;
        emit MarginDeposited(msg.sender, amount);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Queue a withdrawal; queued margin remains slashable but does not confer merchant status.
    function requestMarginWithdrawal(uint256 amount) external {
        if (amount == 0 || amount > margin[msg.sender] || amount > type(uint128).max) revert InvalidAmount();
        if (marginWithdrawal[msg.sender].amount != 0) revert WithdrawalPending();
        uint64 unlockAt = uint64(block.timestamp + MARGIN_WITHDRAW_DELAY);
        marginWithdrawal[msg.sender] = MarginWithdrawal(uint128(amount), unlockAt);
        emit MarginWithdrawalRequested(msg.sender, uint128(amount), unlockAt);
    }

    /// @notice Cancel the caller's queued margin withdrawal.
    function cancelMarginWithdrawal() external {
        uint128 amount = marginWithdrawal[msg.sender].amount;
        if (amount == 0) revert NothingToWithdraw();
        delete marginWithdrawal[msg.sender];
        emit MarginWithdrawalCancelled(msg.sender, amount);
    }

    /// @notice Withdraw unlocked margin once all of the caller's trades are terminal.
    /// @dev A failed token payout becomes claimable via the existing deferred-payout mechanism.
    function completeMarginWithdrawal() external nonReentrant {
        MarginWithdrawal memory pending = marginWithdrawal[msg.sender];
        if (pending.amount == 0) revert NothingToWithdraw();
        if (block.timestamp < pending.unlockAt) revert TooEarly();
        if (partyOpenOrders[msg.sender] != 0) revert OpenOrdersRemain();
        uint256 amount = pending.amount < margin[msg.sender] ? pending.amount : margin[msg.sender];
        margin[msg.sender] -= amount;
        delete marginWithdrawal[msg.sender];
        emit MarginWithdrawn(msg.sender, amount);
        if (amount != 0) _payout(msg.sender, amount);
    }

    /// @notice Ownership cannot be renounced so governance remains available.
    function renounceOwnership() public override onlyOwner {
        revert RenounceDisabled();
    }

    /// @notice Pause only new ad creation and new order opening.
    function pause() external onlyOwner { _pause(); }

    /// @notice Resume new ad creation and new order opening.
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Owner or arbiter can restrict new trading without blocking any exit.
    function setRestricted(address account, bool value) external {
        if (msg.sender != owner() && msg.sender != arbiter) revert NotAdmin();
        restricted[account] = value;
        emit RestrictionUpdated(account, value);
    }

    /// @notice Withdraw an existing deferred USDC payout, including while paused or restricted.
    function withdrawClaimable() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Governance appoints a nonzero arbiter, including for existing disputes.
    function setArbiter(address newArbiter) external onlyOwner {
        if (newArbiter == address(0)) revert InvalidAddress();
        address oldArbiter = arbiter;
        arbiter = newArbiter;
        emit ArbiterUpdated(oldArbiter, newArbiter);
    }

    /// @notice Governance controls currencies for new ads; existing ads/orders are unaffected.
    function setCurrency(bytes3 currency, bool supported) external onlyOwner {
        _setCurrency(currency, supported);
    }

    /// @notice Return one ad; invalid IDs revert.
    function getAd(uint256 id) external view returns (Ad memory) { return _getAd(id); }

    /// @notice Return one order; invalid IDs revert.
    function getOrder(uint256 id) external view returns (Order memory) { return _getOrder(id); }

    /// @notice Return ads with IDs offset+1 onward, clipped to the latest ID.
    function getAds(uint256 offset, uint256 limit) external view returns (Ad[] memory result) {
        uint256 size = offset < adCount ? adCount - offset : 0;
        if (size > limit) size = limit;
        result = new Ad[](size);
        for (uint256 i; i < size; ++i) result[i] = _ads[offset + i + 1];
    }

    /// @notice Return orders with IDs offset+1 onward, clipped to the latest ID.
    function getOrders(uint256 offset, uint256 limit) external view returns (Order[] memory result) {
        uint256 size = offset < orderCount ? orderCount - offset : 0;
        if (size > limit) size = limit;
        result = new Order[](size);
        for (uint256 i; i < size; ++i) result[i] = _orders[offset + i + 1];
    }

    /// @notice Return all order IDs involving a user, in creation order.
    function getUserOrderIds(address user) external view returns (uint256[] memory) {
        return _userOrderIds[user];
    }

    /// @notice Return all ad IDs created by a user, in creation order.
    function getUserAdIds(address user) external view returns (uint256[] memory) {
        return _userAdIds[user];
    }

    /// @notice Return a user's trading statistics.
    function getStats(address user) external view returns (Stats memory) { return stats[user]; }

    /// @notice Return margin not queued for withdrawal, without underflow after slashing.
    function effectiveMargin(address account) public view returns (uint256) {
        uint256 balance = margin[account];
        uint256 pending = marginWithdrawal[account].amount;
        return balance - (pending < balance ? pending : balance);
    }

    /// @notice Whether unqueued margin meets the merchant threshold; not an eligibility guarantee.
    function isMerchant(address account) public view returns (bool) {
        return effectiveMargin(account) >= MERCHANT_MARGIN;
    }

    /// @notice Return combined trading, margin, safety and claimable-payout state.
    /// @dev `restricted` is the explicit flag; disputesLost and bannedUntil remain independently visible.
    function getAccount(address account) external view returns (AccountView memory result) {
        Stats storage s = stats[account];
        MarginWithdrawal storage pending = marginWithdrawal[account];
        Penalty storage penalty = penalties[account];
        result.ordersCreated = s.ordersCreated;
        result.ordersCompleted = s.ordersCompleted;
        result.disputesLost = s.disputesLost;
        result.volume = s.volume;
        result.margin = margin[account];
        result.effectiveMargin = effectiveMargin(account);
        result.pendingWithdrawal = pending.amount;
        result.withdrawalUnlockAt = pending.unlockAt;
        result.merchant = result.effectiveMargin >= MERCHANT_MARGIN;
        result.restricted = restricted[account];
        result.bannedUntil = penalty.bannedUntil;
        result.strikes = penalty.strikes;
        result.partyOpen = partyOpenOrders[account];
        result.claimable = claimable[account];
    }

    /// @dev Entry-only eligibility gate; never applied to an existing trade or withdrawal.
    function _requireEligible(address account) internal view {
        if (restricted[account] || stats[account].disputesLost >= MAX_DISPUTES_LOST) revert Restricted();
        if (block.timestamp < penalties[account].bannedUntil) revert CooldownActive();
    }

    /// @dev Only Pending cancellations where the buyer is the taker add a strike.
    function _addStrike(address buyer) private {
        Penalty storage penalty = penalties[buyer];
        if (block.timestamp > uint256(penalty.windowStart) + STRIKE_WINDOW) {
            penalty.windowStart = uint64(block.timestamp);
            penalty.strikes = 0;
        }
        ++penalty.strikes;
        emit StrikeAdded(buyer, penalty.strikes);
        if (penalty.strikes >= MAX_CANCEL_STRIKES) {
            penalty.bannedUntil = uint64(block.timestamp + COOLDOWN);
            penalty.strikes = 0;
            emit CooldownStarted(buyer, penalty.bannedUntil);
        }
    }

    function _validatePrice(uint128 priceE6) private pure {
        if (priceE6 == 0 || priceE6 > 1e15) revert InvalidPrice();
    }

    function _getAd(uint256 id) private view returns (Ad storage ad) {
        ad = _ads[id];
        if (ad.maker == address(0)) revert AdNotFound(id);
    }

    function _makerAd(uint256 id) private view returns (Ad storage ad) {
        ad = _getAd(id);
        if (msg.sender != ad.maker) revert Unauthorized();
    }

    function _getOrder(uint256 id) private view returns (Order storage order) {
        order = _orders[id];
        if (order.status == OrderStatus.None) revert OrderNotFound(id);
    }

    function _requireStatus(Order storage order, OrderStatus expected) private view {
        if (order.status != expected) revert InvalidStatus(order.status);
    }

    function _payout(address to, uint256 amount) internal {
        try usdc.transfer(to, amount) returns (bool ok) {
            if (!ok) {
                claimable[to] += amount;
                emit PayoutDeferred(to, amount);
            }
        } catch {
            claimable[to] += amount;
            emit PayoutDeferred(to, amount);
        }
    }

    function _finish(Order storage order, OrderStatus terminalStatus) private {
        order.status = terminalStatus;
        --openOrderCount[order.taker];
        --partyOpenOrders[order.buyer];
        --partyOpenOrders[order.seller];
    }

    function _setCurrency(bytes3 currency, bool supported) private {
        supportedCurrency[currency] = supported;
        emit CurrencyUpdated(currency, supported);
    }
}
