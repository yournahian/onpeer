// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title P2PEscrow
/// @notice Non-custodial USDC escrow v2.1 with a flat per-ad listing fee (0% trade fee); governance cannot withdraw escrow.
/// @dev Pass Arc's six-decimal ERC-20 USDC view, 0x3600000000000000000000000000000000000000.
///      No native currency is accepted. Fiat payment is attested by users, not verified on-chain.
///      Includes Phase 2 KYC and privacy hooks (verifier, encryption-key registry, sealed details, hashes), disabled until switched on.
contract P2PEscrow is Ownable2Step {

    uint8 public constant MAX_CANCEL_STRIKES = 3;
    uint256 internal constant STRIKE_WINDOW = 24 hours;
    uint256 internal constant COOLDOWN = 24 hours;
    uint256 public constant GRACE = 5 minutes;
    uint256 internal constant COOLING_OFF = 30 minutes;
    uint256 internal constant LATE_MARK_WINDOW = 30 days;
    uint8 internal constant MAX_LATE_MARKS = 2;
    uint256 internal constant DEFAULT_LISTING_FEE = 50_000;
    uint256 internal constant MAX_LISTING_FEE = 500_000;
    uint8 internal constant DETAILS_PLAIN = 0;
    uint8 internal constant DETAILS_HANDSHAKE = 1;
    uint8 internal constant DETAILS_AUTO = 2;
    uint256 internal constant BOND_MIN = 2e6;
    uint256 internal constant BOND_MAX = 5e6;
    uint256 internal constant BOND_BPS = 500;
    uint256 internal constant BACKUP_ARBITER_DELAY = 7 days;
    uint16 internal constant MIN_AD_TTL_HOURS = 1;
    uint16 internal constant MAX_AD_TTL_HOURS = 168;
    uint256 internal constant REVEAL_WINDOW = 10 minutes;
    uint32 internal constant BUY_AD_MIN_COMPLETED = 3;
    uint256 public constant MAX_DEBTS_PER_ACCOUNT = 8;
    uint256 internal constant TIER0_CAP = 200e6;
    uint256 internal constant TIER1_CAP = 500e6;
    uint256 internal constant TIER2_CAP = 2_000e6;
    uint256 internal constant TIER2_MIN_AGE = 7 days;
    uint256 internal constant TIER3_MIN_AGE = 14 days;
    uint256 internal constant QUALIFY_MIN = 10e6;
    uint256 internal constant MERCHANT_MARGIN = 100e6;
    uint256 internal constant MARGIN_WITHDRAW_DELAY = 7 days;
    uint256 internal constant MESSAGE_MAX = 280;

    enum Side { Sell, Buy }
    enum OrderStatus {
        None,
        Pending,
        Paid,
        Completed,
        Cancelled,
        Disputed,
        ResolvedToBuyer,
        ResolvedToSeller,
        Settled
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
        uint64 expiresAt;
        uint8 detailsMode;
        bytes32 detailsHash;
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
        uint128 bond;
        bool paidLate;
        bool detailsReady;
        bytes32 detailsHash;
        bytes32 payerProof;
        uint64 revealDeadline;
        uint64 reviewStartedAt;
    }

    /// @notice ordersCompleted counts releases of at least QUALIFY_MIN with distinct counterparties.
    /// @dev Each unordered pair counts once for both parties. Every 2 concessions count as 1 lost dispute.
    struct Stats {
        uint32 ordersCreated;
        uint32 ordersCompleted;
        uint32 disputesLost;
        uint128 volume;
        uint32 disputesSettled;
        uint64 firstSeen;
        uint32 concessions;
        uint8 lateMarks;
        uint64 lateMarkWindowStart;
    }

    /// @notice Onchain KYC status attested by the verifier role (no personal data stored).
    struct Verification {
        uint8 level;
        uint64 expiry;
    }

    /// @notice Unpaid dispute-bond obligation owed to a dispute winner.
    struct Debt {
        address creditor;
        uint128 amount;
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

    /// @notice Combined trading, safety, margin, tier, debt, KYC and deferred-payout information.
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
        uint64 firstSeen;
        uint256 totalDebt;
        uint256 orderCap;
        uint8 tier;
        uint32 disputesSettled;
        bool disputeLimitReached;
        uint32 concessions;
        uint8 lateMarks;
    }

    mapping(address => bool) public restricted;
    mapping(address => bool) public disputeLimitWaived;
    mapping(address => Penalty) public penalties;
    mapping(address => uint256) public margin;
    mapping(address => MarginWithdrawal) public marginWithdrawal;
    mapping(address => uint256) public partyOpenOrders;

    IERC20 public immutable usdc;
    uint64 internal immutable DOLLAR_UNIT;
    uint64 internal immutable TOKEN_UNIT;
    uint256 private _reentrancyStatus = 1;
    address public arbiter;
    address public backupArbiter;
    address public feeRecipient;
    address public verifier;
    uint256 public listingFee;
    uint256 public feesAccrued;
    bool public paused;
    bool public sealedEnabled;
    bool public payerProofRequired;
    bool public kycRequired;

    uint256 public adCount;
    uint256 public orderCount;
    mapping(bytes3 => bool) public supportedCurrency;
    mapping(address => uint256) public openOrderCount;
    mapping(address => Stats) private stats;
    mapping(address => Verification) public verification;
    mapping(uint256 => Ad) private _ads;
    mapping(uint256 => Order) private _orders;
    mapping(address => uint256[]) private _userOrderIds;
    mapping(address => uint256[]) private _userAdIds;
    mapping(address => uint256) public claimable;
    mapping(bytes32 => bool) public pairCounted;
    mapping(address => Debt[]) private _debts;
    mapping(address => uint256) public totalDebt;
    mapping(address => bytes) public encryptionKey;

    error InvalidAddress();
    error UnsupportedCurrency(bytes3 currency);
    error InvalidPrice();
    error InvalidAmount();
    error InvalidPaymentMask();
    error InvalidWindow();
    error InvalidTtl();
    error InvalidDetails();
    error InvalidDetailsMode();
    error InvalidFee();
    error AdNotFound(uint256 adId);
    error OrderNotFound(uint256 orderId);
    error Unauthorized();
    error AdUnavailable();
    error AdExpired();
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
    error DebtOutstanding();
    error CooldownActive();
    error RequirementNotMet();
    error AboveCap();
    error BuyAdNotAllowed();
    error SealedDisabled();
    error PayerProofRequired();
    error LateMarkLimit();
    error NotVerified();
    error InvalidVerification();
    error DetailsAlreadyReady();
    error DetailsNotReady();
    error InvalidEncryptionKey();
    error WithdrawalPending();
    error OpenOrdersRemain();
    error InvalidMessage();
    error InvalidSide();
    error MerchantMarginTooLow();
    error RenounceDisabled();
    error EnforcedPause();
    error ReentrancyGuardReentrantCall();
    error SafeERC20FailedOperation(address token);

    event Paused(address account);
    event Unpaused(address account);

    modifier nonReentrant() {
        if (_reentrancyStatus == 2) revert ReentrancyGuardReentrantCall();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    event RestrictionUpdated(address indexed account, bool restricted);
    event DisputeWaiverUpdated(address indexed account, bool waived);
    event StrikeAdded(address indexed buyer, uint8 strikes);
    event CooldownStarted(address indexed buyer, uint64 bannedUntil);
    event MarginDeposited(address indexed account, uint256 amount);
    event MarginWithdrawalRequested(address indexed account, uint128 amount, uint64 unlockAt);
    event MarginWithdrawalCancelled(address indexed account, uint128 amount);
    event MarginWithdrawn(address indexed account, uint256 amount);
    event MarginSlashed(uint256 indexed orderId, address indexed loser, address indexed winner, uint256 amount);
    event DebtCreated(uint256 indexed orderId, address indexed debtor, address indexed creditor, uint128 amount);
    event DebtRepaid(address indexed debtor, address indexed creditor, uint256 amount);
    event OrderMessage(uint256 indexed orderId, address indexed sender, string text);
    event EncryptionKeyRegistered(address indexed account, bytes key);

    event AdCreated(uint256 indexed adId, address indexed maker, Side side, bytes3 currency, uint128 totalAmount);
    event AdRefreshed(uint256 indexed adId, uint64 expiresAt);
    event AdPriceUpdated(uint256 indexed adId, uint128 oldPriceE6, uint128 newPriceE6);
    event AdPaused(uint256 indexed adId, bool paused);
    event AdClosed(uint256 indexed adId, uint128 remaining, uint128 refunded);
    event OrderOpened(uint256 indexed orderId, uint256 indexed adId, address indexed buyer, address seller, uint128 amount);
    event DetailsShared(uint256 indexed orderId, bytes32 detailsHash, uint64 deadline);
    event OrderPaid(uint256 indexed orderId, uint64 paidAt);
    event OrderReleased(uint256 indexed orderId, address indexed buyer, uint128 amount);
    event OrderCancelled(uint256 indexed orderId, address indexed caller);
    event OrderDisputed(uint256 indexed orderId, address indexed caller, uint64 disputedAt);
    event CaseTaken(uint256 indexed orderId, address indexed arbiter, uint64 reviewStartedAt);
    event DisputeSettled(uint256 indexed orderId, address indexed caller, address indexed recipient, uint128 amount);
    event DisputeResolved(uint256 indexed orderId, bool toBuyer, address indexed recipient, uint128 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event PayoutDeferred(address indexed to, uint256 amount);
    event ArbiterUpdated(address indexed oldArbiter, address indexed newArbiter);
    event BackupArbiterUpdated(address indexed oldBackupArbiter, address indexed newBackupArbiter);
    event ListingFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event FeesCollected(address indexed recipient, uint256 amount);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event VerificationUpdated(address indexed account, uint8 level, uint64 expiry);
    event VerificationRevoked(address indexed account, address indexed caller);
    event KycRequiredUpdated(bool required);
    event SealedEnabledUpdated(bool enabled);
    event PayerProofRequiredUpdated(bool required);
    event CurrencyUpdated(bytes3 indexed currency, bool supported);

    /// @param usdc_ Six-decimal Arc USDC ERC-20 address (not the native-currency interface).
    /// @param initialOwner Governance address (and default feeRecipient), with two-step ownership transfers.
    /// @param initialArbiter Initial primary dispute resolver; cannot resolve its own trades.
    /// @param initialBackupArbiter Initial backup resolver, able to rule once a dispute is 7 days old.
    constructor(address usdc_, address initialOwner, address initialArbiter, address initialBackupArbiter)
        Ownable(initialOwner)
    {
        if (
            usdc_ == address(0) || usdc_.code.length == 0 || initialArbiter == address(0)
                || initialBackupArbiter == address(0)
        ) {
            revert InvalidAddress();
        }
        usdc = IERC20(usdc_);
        uint8 dec = 6;
        try IERC20Metadata(usdc_).decimals() returns (uint8 d) {
            if (d > 0 && d <= 18) dec = d;
        } catch {}
        uint64 du = dec == 8 ? 1_000 : (dec == 18 ? 400_000_000_000_000 : 1_000_000);
        DOLLAR_UNIT = du;
        TOKEN_UNIT = uint64(10 ** uint256(dec));
        uint256 defaultFee = uint256(du) / 20;
        arbiter = initialArbiter;
        backupArbiter = initialBackupArbiter;
        listingFee = defaultFee;
        feeRecipient = initialOwner;
        emit ArbiterUpdated(address(0), initialArbiter);
        emit BackupArbiterUpdated(address(0), initialBackupArbiter);
        emit ListingFeeUpdated(0, defaultFee);
        emit FeeRecipientUpdated(address(0), initialOwner);
        _setCurrency("INR", true);
        _setCurrency("PKR", true);
        _setCurrency("BDT", true);
        _setCurrency("LKR", true);
        _setCurrency("NPR", true);
        _setCurrency("BTN", true);
        _setCurrency("MVR", true);
        _setCurrency("AFN", true);
    }

    /// @notice Create an ad. Charges flat listingFee; Sell ads also deposit totalAmount USDC; Buy ads require Merchant or >= 3 completed trades.
    /// @dev Amounts use six USDC decimals; priceE6 is fiat per USDC scaled by 1e6; detailsMode: 0 plain, 1 handshake, 2 autoReveal.
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
        uint16 ttlHours,
        uint8 detailsMode,
        bytes32 detailsHash,
        string calldata details
    ) external nonReentrant returns (uint256) {
        _requireEligible(msg.sender);
        if (side > uint8(Side.Buy)) revert InvalidSide();
        if (
            side == uint8(Side.Buy) && !isMerchant(msg.sender)
                && stats[msg.sender].ordersCompleted < BUY_AD_MIN_COMPLETED
        ) {
            revert BuyAdNotAllowed();
        }
        if (!supportedCurrency[currency]) revert UnsupportedCurrency(currency);
        _validatePrice(priceE6);
        if (minAmount == 0 || minAmount > maxAmount || maxAmount > totalAmount) revert InvalidAmount();
        if (paymentMask == 0) revert InvalidPaymentMask();
        if (windowMinutes < 10 || windowMinutes > 1440) revert InvalidWindow();
        if (ttlHours < MIN_AD_TTL_HOURS || ttlHours > MAX_AD_TTL_HOURS) revert InvalidTtl();
        if (detailsMode > DETAILS_AUTO) revert InvalidDetailsMode();
        if (detailsMode != DETAILS_PLAIN) {
            if (!sealedEnabled) revert SealedDisabled();
            if (detailsHash == bytes32(0)) revert InvalidDetails();
        }
        if (
            bytes(details).length > 200
                || (detailsMode == DETAILS_PLAIN && side == uint8(Side.Sell) && bytes(details).length == 0)
        ) {
            revert InvalidDetails();
        }

        _touchFirstSeen(msg.sender);

        uint256 fee = listingFee;
        uint256 adId;
        unchecked {
            if (fee != 0) feesAccrued += fee;
            adId = ++adCount;
        }
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
        unchecked {
            ad.expiresAt = uint64(block.timestamp + uint256(ttlHours) * 1 hours);
        }
        ad.detailsMode = detailsMode;
        ad.detailsHash = detailsHash;

        _userAdIds[msg.sender].push(adId);
        emit AdCreated(adId, msg.sender, ad.side, ad.currency, ad.initialAmount);
        uint256 pull;
        unchecked {
            pull = (ad.side == Side.Sell ? uint256(ad.initialAmount) : 0) + fee;
        }
        if (pull != 0) _pullUsdc(msg.sender, pull);
        return adId;
    }

    /// @notice Extend an open ad's expiry window from the current timestamp.
    function refreshAd(uint256 adId, uint16 ttlHours) external {
        Ad storage ad = _makerAd(adId);
        if (ad.closed) revert AdUnavailable();
        if (ttlHours < MIN_AD_TTL_HOURS || ttlHours > MAX_AD_TTL_HOURS) revert InvalidTtl();
        uint64 expiresAt;
        unchecked {
            expiresAt = uint64(block.timestamp + uint256(ttlHours) * 1 hours);
        }
        ad.expiresAt = expiresAt;
        emit AdRefreshed(adId, expiresAt);
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
    function setAdPaused(uint256 adId, bool paused_) external {
        Ad storage ad = _makerAd(adId);
        if (ad.closed) revert AdUnavailable();
        ad.paused = paused_;
        emit AdPaused(adId, paused_);
    }

    /// @notice Permanently close an ad (including expired ads) and refund unreserved Sell inventory.
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
    /// @param detailsHash Ciphertext commitment for sealed Buy ads (or optional fingerprint in plain mode).
    /// @param paymentDetails Seller's fiat receiving details for plain Buy ads; ignored for Sell ads.
    function openOrder(
        uint256 adId,
        uint128 amount,
        uint128 limitPriceE6,
        bytes32 detailsHash,
        string calldata paymentDetails
    ) external nonReentrant returns (uint256 orderId) {
        _requireEligible(msg.sender);
        Ad storage ad = _getAd(adId);
        _requireEligible(ad.maker);
        if (ad.closed || ad.paused) revert AdUnavailable();
        if (block.timestamp > ad.expiresAt) revert AdExpired();
        if (ad.merchantAd && !isMerchant(ad.maker)) revert MerchantMarginTooLow();
        if (msg.sender == ad.maker) revert SelfTrade();
        if (stats[msg.sender].ordersCompleted < ad.minTakerCompleted) revert RequirementNotMet();
        if (amount == 0 || amount > ad.available) revert InvalidAmount();
        if (amount > ad.maxAmount || (amount < ad.minAmount && amount != ad.available)) {
            revert InvalidAmount();
        }
        if (amount > orderCap(msg.sender)) revert AboveCap();
        if ((ad.side == Side.Sell && ad.priceE6 > limitPriceE6) || (ad.side == Side.Buy && ad.priceE6 < limitPriceE6)) {
            revert PriceMoved();
        }
        if (openOrderCount[msg.sender] >= 5) revert OpenOrderLimit(msg.sender);
        if (ad.detailsMode != DETAILS_PLAIN && !sealedEnabled) revert SealedDisabled();
        if (bytes(paymentDetails).length > 200) revert InvalidDetails();
        if (ad.side == Side.Buy) {
            if (ad.detailsMode != DETAILS_PLAIN) {
                if (detailsHash == bytes32(0)) revert InvalidDetails();
            } else if (bytes(paymentDetails).length == 0) {
                revert InvalidDetails();
            }
        }

        _touchFirstSeen(msg.sender);

        unchecked {
            ad.available -= amount;
            orderId = ++orderCount;
        }
        Order storage order = _orders[orderId];
        order.adId = adId;
        order.buyer = ad.side == Side.Sell ? msg.sender : ad.maker;
        order.seller = ad.side == Side.Sell ? ad.maker : msg.sender;
        order.currency = ad.currency;
        order.status = OrderStatus.Pending;
        order.paymentMask = ad.paymentMask;
        order.createdAt = uint64(block.timestamp);
        order.amount = amount;
        order.priceE6 = ad.priceE6;
        unchecked {
            order.fiatAmountE6 = uint256(amount) * uint256(ad.priceE6) / uint256(TOKEN_UNIT);
        }
        order.taker = msg.sender;
        order.bond = computeBond(amount);

        unchecked {
            if (ad.side == Side.Sell) {
                if (ad.detailsMode == DETAILS_HANDSHAKE) {
                    order.detailsReady = false;
                    order.revealDeadline = uint64(block.timestamp + REVEAL_WINDOW);
                } else {
                    order.detailsReady = true;
                    order.deadline = uint64(block.timestamp + uint256(ad.windowMinutes) * 60);
                    order.detailsHash = ad.detailsHash;
                }
            } else {
                order.detailsReady = true;
                order.deadline = uint64(block.timestamp + uint256(ad.windowMinutes) * 60);
                order.detailsHash = detailsHash;
                if (ad.detailsMode == DETAILS_PLAIN) order.paymentDetails = paymentDetails;
            }

            ++openOrderCount[order.taker];
            ++partyOpenOrders[order.buyer];
            ++partyOpenOrders[order.seller];
            ++stats[order.buyer].ordersCreated;
            ++stats[order.seller].ordersCreated;
        }
        _userOrderIds[order.buyer].push(orderId);
        _userOrderIds[order.seller].push(orderId);
        emit OrderOpened(orderId, adId, order.buyer, order.seller, amount);
        if (ad.side == Side.Buy) _pullUsdc(msg.sender, amount);
    }

    /// @notice Seller reveals encrypted receiving-details hash for a handshake Sell order and starts the payment timer.
    function shareDetails(uint256 orderId, bytes32 detailsHash) external {
        Order storage order = _getOrder(orderId);
        if (msg.sender != order.seller) revert Unauthorized();
        _requireStatus(order, OrderStatus.Pending);
        if (order.detailsReady) revert DetailsAlreadyReady();
        if (block.timestamp > order.revealDeadline) revert DeadlinePassed();
        if (detailsHash == bytes32(0)) revert InvalidDetails();

        Ad storage ad = _ads[order.adId];
        uint64 deadline;
        unchecked {
            deadline = uint64(block.timestamp + uint256(ad.windowMinutes) * 60);
        }
        order.detailsReady = true;
        order.detailsHash = detailsHash;
        order.deadline = deadline;
        emit DetailsShared(orderId, detailsHash, deadline);
    }

    /// @notice Buyer attests to sending fiat within the payment deadline plus the 5-minute grace window.
    /// @dev Late marks always require payerProof != 0 and are capped at 2 per rolling 30-day window.
    function markPaid(uint256 orderId, bytes32 payerProof) external {
        Order storage order = _getOrder(orderId);
        if (msg.sender != order.buyer) revert Unauthorized();
        _requireStatus(order, OrderStatus.Pending);
        if (!order.detailsReady) revert DetailsNotReady();
        unchecked {
            if (block.timestamp > uint256(order.deadline) + GRACE) revert DeadlinePassed();
        }
        bool late = block.timestamp > order.deadline;
        if ((late || payerProofRequired) && payerProof == bytes32(0)) revert PayerProofRequired();
        if (late) {
            Stats storage s = stats[msg.sender];
            unchecked {
                if (s.lateMarkWindowStart == 0 || block.timestamp > uint256(s.lateMarkWindowStart) + LATE_MARK_WINDOW) {
                    s.lateMarkWindowStart = uint64(block.timestamp);
                    s.lateMarks = 0;
                }
                if (s.lateMarks >= MAX_LATE_MARKS) revert LateMarkLimit();
                ++s.lateMarks;
            }
        }

        order.status = OrderStatus.Paid;
        order.paidAt = uint64(block.timestamp);
        order.paidLate = late;
        order.payerProof = payerProof;
        emit OrderPaid(orderId, order.paidAt);
    }

    /// @notice Seller releases USDC in Pending, Paid or Disputed.
    /// @dev Releasing from Disputed settles without completion credit or bond (clean in 30m cooling-off, concession after, loss if in review).
    function release(uint256 orderId) external nonReentrant {
        Order storage order = _getOrder(orderId);
        if (msg.sender != order.seller) revert Unauthorized();
        OrderStatus st = order.status;
        if (st == OrderStatus.Disputed) {
            _settleDisputed(orderId, order, order.seller, order.buyer);
        } else {
            if (st != OrderStatus.Pending && st != OrderStatus.Paid) revert InvalidStatus(st);
            _finish(order, OrderStatus.Completed);
            unchecked {
                if (order.amount >= uint256(DOLLAR_UNIT) * 10) {
                    (address lo, address hi) =
                        order.buyer < order.seller ? (order.buyer, order.seller) : (order.seller, order.buyer);
                    bytes32 pairKey = keccak256(abi.encodePacked(lo, hi));
                    if (!pairCounted[pairKey]) {
                        pairCounted[pairKey] = true;
                        ++stats[order.buyer].ordersCompleted;
                        ++stats[order.seller].ordersCompleted;
                    }
                }
                stats[order.buyer].volume += order.amount;
                stats[order.seller].volume += order.amount;
            }
            emit OrderReleased(orderId, order.buyer, order.amount);
            _payout(order.buyer, order.amount);
        }
    }

    /// @notice Cancel a Pending order (buyer anytime; others after grace/reveal expiry) or settle a Disputed order as buyer.
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = _getOrder(orderId);
        OrderStatus st = order.status;
        if (st == OrderStatus.Disputed) {
            if (msg.sender != order.buyer) revert Unauthorized();
            _settleDisputed(orderId, order, order.buyer, order.seller);
        } else {
            if (st != OrderStatus.Pending) revert InvalidStatus(st);
            uint256 expiry;
            unchecked {
                expiry = order.detailsReady ? uint256(order.deadline) + GRACE : uint256(order.revealDeadline);
            }
            if (msg.sender != order.buyer && block.timestamp <= expiry) revert Unauthorized();

            Ad storage ad = _ads[order.adId];
            _finish(order, OrderStatus.Cancelled);
            if (order.buyer == order.taker) {
                if (order.detailsReady) _addStrike(order.buyer);
            } else if (!ad.closed) {
                ad.paused = true;
                emit AdPaused(order.adId, true);
            }
            if (!ad.closed) {
                unchecked {
                    ad.available += order.amount;
                }
            }
            emit OrderCancelled(orderId, msg.sender);
            if (ad.side == Side.Buy) _payout(order.seller, order.amount);
            else if (ad.closed) _payout(ad.maker, order.amount);
        }
    }

    /// @notice Permissionless fallback: seller may dispute Paid orders immediately; buyer after 15 minutes. No bond upfront.
    function openDispute(uint256 orderId) external {
        Order storage order = _getOrder(orderId);
        _requireStatus(order, OrderStatus.Paid);
        if (msg.sender != order.seller) {
            if (msg.sender != order.buyer) revert Unauthorized();
            unchecked {
                if (block.timestamp < uint256(order.paidAt) + 15 minutes) revert TooEarly();
            }
        }
        order.status = OrderStatus.Disputed;
        order.disputedAt = uint64(block.timestamp);
        emit OrderDisputed(orderId, msg.sender, order.disputedAt);
    }

    /// @notice Arbiter (or backupArbiter after 7 days) takes an offchain/onchain dispute into active review.
    function takeCase(uint256 orderId) external {
        Order storage order = _getOrder(orderId);
        _startReview(orderId, order);
        order.status = OrderStatus.Disputed;
        emit CaseTaken(orderId, msg.sender, order.reviewStartedAt);
    }

    /// @notice Primary arbiter (or backupArbiter after 7 days) awards full escrow to winner from Paid or Disputed.
    /// @param slashLoser Extra compensation from remaining margin up to the order amount.
    /// @param applyBond Whether the loser owes the dispute bond (from free margin first, shortfall as Debt).
    function resolveDispute(uint256 orderId, bool toBuyer, bool slashLoser, bool applyBond) external nonReentrant {
        Order storage order = _getOrder(orderId);
        _startReview(orderId, order);

        address recipient = toBuyer ? order.buyer : order.seller;
        address loser = toBuyer ? order.seller : order.buyer;
        _finish(order, toBuyer ? OrderStatus.ResolvedToBuyer : OrderStatus.ResolvedToSeller);

        Stats storage s = stats[loser];
        uint32 oldEff = _effectiveLosses(s);
        unchecked {
            ++s.disputesLost;
        }
        _checkClearWaiver(loser, s, oldEff);

        uint256 extra = P2PEscrowDebtLib.applyRuling(
            orderId,
            order,
            loser,
            recipient,
            slashLoser,
            applyBond,
            margin,
            marginWithdrawal,
            _debts,
            totalDebt
        );

        emit DisputeResolved(orderId, toBuyer, recipient, order.amount);
        unchecked {
            _payout(recipient, uint256(order.amount) + extra);
        }
    }

    /// @notice Repay outstanding dispute-bond debts oldest first; pulls at most caller's totalDebt.
    function repayDebt(uint256 amount) external nonReentrant {
        uint256 owed = totalDebt[msg.sender];
        if (amount == 0 || owed == 0) revert InvalidAmount();
        uint256 pay = amount < owed ? amount : owed;
        _pullUsdc(msg.sender, pay);
        _repayDebtFromEscrow(msg.sender, pay);
    }

    /// @notice Emit a public trade message without persisting its text in storage (emergency fallback).
    function postMessage(uint256 orderId, string calldata text) external {
        Order storage order = _getOrder(orderId);
        _requireMessageSender(order);
        if (bytes(text).length == 0 || bytes(text).length > MESSAGE_MAX) revert InvalidMessage();
        emit OrderMessage(orderId, msg.sender, text);
    }

    /// @notice Register or rotate caller's public encryption key (33..65 bytes).
    function registerEncryptionKey(bytes calldata key) external {
        if (key.length < 33 || key.length > 65) revert InvalidEncryptionKey();
        encryptionKey[msg.sender] = key;
        emit EncryptionKeyRegistered(msg.sender, key);
    }

    /// @notice Return registered encryption keys for an order's buyer, seller and current primary arbiter.
    function encryptionKeysFor(uint256 orderId)
        external
        view
        returns (bytes memory buyerKey, bytes memory sellerKey, bytes memory arbiterKey)
    {
        Order storage order = _getOrder(orderId);
        return (encryptionKey[order.buyer], encryptionKey[order.seller], encryptionKey[arbiter]);
    }

    /// @notice Deposit six-decimal USDC as security margin; offsets any unpaid debt of the caller first.
    function depositMargin(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _pullUsdc(msg.sender, amount);
        uint256 owed = totalDebt[msg.sender];
        uint256 toDebt = amount < owed ? amount : owed;
        uint256 toMargin;
        unchecked {
            toMargin = amount - toDebt;
        }
        if (toDebt != 0) {
            _repayDebtFromEscrow(msg.sender, toDebt);
        }
        if (toMargin != 0) {
            unchecked {
                margin[msg.sender] += toMargin;
            }
            emit MarginDeposited(msg.sender, toMargin);
        }
    }

    /// @notice Queue a withdrawal; queued margin remains slashable for extra slashes but is not free margin.
    function requestMarginWithdrawal(uint256 amount) external {
        if (amount == 0 || amount > margin[msg.sender] || amount > type(uint128).max) revert InvalidAmount();
        if (marginWithdrawal[msg.sender].amount != 0) revert WithdrawalPending();
        uint64 unlockAt;
        unchecked {
            unlockAt = uint64(block.timestamp + MARGIN_WITHDRAW_DELAY);
        }
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
    function completeMarginWithdrawal() external nonReentrant {
        MarginWithdrawal memory pending = marginWithdrawal[msg.sender];
        if (pending.amount == 0) revert NothingToWithdraw();
        if (block.timestamp < pending.unlockAt) revert TooEarly();
        if (partyOpenOrders[msg.sender] != 0) revert OpenOrdersRemain();
        uint256 amount = pending.amount < margin[msg.sender] ? pending.amount : margin[msg.sender];
        unchecked {
            margin[msg.sender] -= amount;
        }
        delete marginWithdrawal[msg.sender];
        emit MarginWithdrawn(msg.sender, amount);
        if (amount != 0) _payout(msg.sender, amount);
    }

    /// @notice Ownership cannot be renounced so governance remains available.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @notice Pause only new ad creation and new order opening.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume new ad creation and new order opening.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Owner or arbiter can restrict new trading without blocking any exit.
    function setRestricted(address account, bool value) external {
        _requireAdmin();
        restricted[account] = value;
        emit RestrictionUpdated(account, value);
    }

    /// @notice Owner or arbiter can waive (or reinstate) the automatic lost-dispute restriction.
    function setDisputeWaiver(address account, bool waived) external {
        _requireAdmin();
        _nonZero(account);
        disputeLimitWaived[account] = waived;
        emit DisputeWaiverUpdated(account, waived);
    }

    /// @notice Withdraw an existing deferred USDC payout; consumes claimable to repay caller's debt first.
    function withdrawClaimable() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;

        uint256 owed = totalDebt[msg.sender];
        uint256 toDebt = amount < owed ? amount : owed;
        uint256 remainder;
        unchecked {
            remainder = amount - toDebt;
        }

        if (toDebt != 0) {
            _repayDebtFromEscrow(msg.sender, toDebt);
        }
        if (remainder != 0) {
            emit Withdrawn(msg.sender, remainder);
            _pushUsdc(msg.sender, remainder);
        }
    }

    /// @notice Governance sets the flat per-ad listing fee (capped at 0.50 USDC); affects future ads only.
    function setListingFee(uint256 newFee) external onlyOwner {
        unchecked {
            if (newFee > uint256(DOLLAR_UNIT) / 2) revert InvalidFee();
        }
        uint256 oldFee = listingFee;
        listingFee = newFee;
        emit ListingFeeUpdated(oldFee, newFee);
    }

    /// @notice Governance updates the nonzero listing-fee recipient.
    function setFeeRecipient(address newRecipient) external onlyOwner {
        _nonZero(newRecipient);
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /// @notice Permissionlessly transfer accrued listing fees to feeRecipient (blocklist-safe via _payout).
    function collectFees() external nonReentrant {
        uint256 amount = feesAccrued;
        if (amount == 0) revert NothingToWithdraw();
        feesAccrued = 0;
        address recipient = feeRecipient;
        emit FeesCollected(recipient, amount);
        _payout(recipient, amount);
    }

    /// @notice Governance appoints or clears the KYC verifier address (verifier can never move funds).
    function setVerifier(address newVerifier) external onlyOwner {
        address oldVerifier = verifier;
        verifier = newVerifier;
        emit VerifierUpdated(oldVerifier, newVerifier);
    }

    /// @notice Governance toggles whether createAd and openOrder require active KYC verification.
    function setKycRequired(bool required) external onlyOwner {
        kycRequired = required;
        emit KycRequiredUpdated(required);
    }

    /// @notice Verifier records an address's KYC level (>= 1) and future expiry timestamp.
    function setVerification(address account, uint8 level, uint64 expiry) external {
        if (msg.sender != verifier) revert Unauthorized();
        _nonZero(account);
        if (level == 0 || expiry <= block.timestamp) revert InvalidVerification();
        verification[account] = Verification({level: level, expiry: expiry});
        emit VerificationUpdated(account, level, expiry);
    }

    /// @notice Verifier or owner revokes an address's KYC verification.
    function revokeVerification(address account) external {
        if (msg.sender != verifier && msg.sender != owner()) revert Unauthorized();
        _nonZero(account);
        delete verification[account];
        emit VerificationRevoked(account, msg.sender);
    }

    /// @notice Whether `account` holds a non-expired verification with level >= 1.
    function isVerified(address account) public view returns (bool) {
        Verification storage v = verification[account];
        return v.level != 0 && block.timestamp <= v.expiry;
    }

    /// @notice Governance appoints a nonzero primary arbiter, including for existing disputes.
    function setArbiter(address newArbiter) external onlyOwner {
        _nonZero(newArbiter);
        address oldArbiter = arbiter;
        arbiter = newArbiter;
        emit ArbiterUpdated(oldArbiter, newArbiter);
    }

    /// @notice Governance appoints a nonzero backup arbiter able to rule disputes >= 7 days old.
    function setBackupArbiter(address newBackupArbiter) external onlyOwner {
        _nonZero(newBackupArbiter);
        address oldBackup = backupArbiter;
        backupArbiter = newBackupArbiter;
        emit BackupArbiterUpdated(oldBackup, newBackupArbiter);
    }

    /// @notice Governance enables or disables creation and opening of sealed-details ads.
    function setSealedEnabled(bool enabled) external onlyOwner {
        sealedEnabled = enabled;
        emit SealedEnabledUpdated(enabled);
    }

    /// @notice Governance toggles whether markPaid requires a non-zero payerProof hash.
    function setPayerProofRequired(bool required) external onlyOwner {
        payerProofRequired = required;
        emit PayerProofRequiredUpdated(required);
    }

    /// @notice Governance controls currencies for new ads; existing ads/orders are unaffected.
    function setCurrency(bytes3 currency, bool supported) external onlyOwner {
        _setCurrency(currency, supported);
    }

    /// @notice Dispute bond for an order size: min(5 USDC, max(2 USDC, 5% of amount)).
    function computeBond(uint128 amount) public view returns (uint128) {
        unchecked {
            uint256 du = DOLLAR_UNIT;
            uint256 bMin = du * 2;
            uint256 bMax = du * 5;
            uint256 pct = uint256(amount) * BOND_BPS / 10_000;
            uint256 b = pct > bMin ? pct : bMin;
            if (b > bMax) b = bMax;
            return uint128(b);
        }
    }

    /// @notice Per-order taker cap in six-decimal USDC based on completed trades, account age, KYC level and merchant status.
    function orderCap(address account) public view returns (uint256 cap) {
        (, cap) = _tierOf(account);
    }

    /// @notice Whether an account has hit the automatic lost-dispute limit (1 if <3 completed, else 2; 2 concessions = 1 loss) and is not waived.
    function isDisputeLimitReached(address account) public view returns (bool) {
        if (disputeLimitWaived[account]) return false;
        Stats storage s = stats[account];
        return _effectiveLosses(s) >= _lossLimit(s);
    }

    /// @notice Return outstanding debt records owed by `account` in FIFO repayment order.
    function getDebts(address account) external view returns (Debt[] memory) {
        return _debts[account];
    }

    /// @notice Return one ad; invalid IDs revert.
    function getAd(uint256 id) external view returns (Ad memory) { return _getAd(id); }

    /// @notice Return one order; invalid IDs revert.
    function getOrder(uint256 id) external view returns (Order memory) { return _copyOrder(_getOrder(id)); }

    /// @notice Return ads with IDs offset+1 onward, clipped to the latest ID.
    function getAds(uint256 offset, uint256 limit) external view returns (Ad[] memory result) {
        unchecked {
            uint256 size = _pageSize(adCount, offset, limit);
            result = new Ad[](size);
            for (uint256 i; i < size; ++i) result[i] = _ads[offset + i + 1];
        }
    }

    /// @notice Return orders with IDs offset+1 onward, clipped to the latest ID.
    function getOrders(uint256 offset, uint256 limit) external view returns (Order[] memory result) {
        unchecked {
            uint256 size = _pageSize(orderCount, offset, limit);
            result = new Order[](size);
            for (uint256 i; i < size; ++i) result[i] = _copyOrder(_orders[offset + i + 1]);
        }
    }

    function _pageSize(uint256 total, uint256 offset, uint256 limit) private pure returns (uint256 size) {
        unchecked {
            size = offset < total ? total - offset : 0;
        }
        if (size > limit) size = limit;
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
        unchecked {
            return balance - (pending < balance ? pending : balance);
        }
    }

    /// @notice Whether unqueued margin meets the merchant threshold; not an eligibility guarantee.
    function isMerchant(address account) public view returns (bool) {
        unchecked {
            return effectiveMargin(account) >= uint256(DOLLAR_UNIT) * 100;
        }
    }

    /// @notice Return combined trading, margin, safety, tier, debt and claimable-payout state.
    function getAccount(address account) external view returns (AccountView memory result) {
        Stats storage s = stats[account];
        MarginWithdrawal storage pending = marginWithdrawal[account];
        Penalty storage penalty = penalties[account];
        (uint8 tier, uint256 cap) = _tierOf(account);

        result.ordersCreated = s.ordersCreated;
        result.ordersCompleted = s.ordersCompleted;
        result.disputesLost = s.disputesLost;
        result.volume = s.volume;
        result.margin = margin[account];
        unchecked {
            result.effectiveMargin =
                result.margin - (pending.amount < result.margin ? pending.amount : result.margin);
            result.merchant = result.effectiveMargin >= uint256(DOLLAR_UNIT) * 100;
        }
        result.pendingWithdrawal = pending.amount;
        result.withdrawalUnlockAt = pending.unlockAt;
        result.restricted = restricted[account];
        result.bannedUntil = penalty.bannedUntil;
        result.strikes = penalty.strikes;
        result.partyOpen = partyOpenOrders[account];
        result.claimable = claimable[account];
        result.firstSeen = s.firstSeen;
        result.totalDebt = totalDebt[account];
        result.orderCap = cap;
        result.tier = tier;
        result.disputesSettled = s.disputesSettled;
        result.disputeLimitReached = isDisputeLimitReached(account);
        result.concessions = s.concessions;
        unchecked {
            result.lateMarks =
                s.lateMarkWindowStart == 0 || block.timestamp > uint256(s.lateMarkWindowStart) + LATE_MARK_WINDOW
                    ? 0
                    : s.lateMarks;
        }
    }

    function _nonZero(address a) private pure {
        if (a == address(0)) revert InvalidAddress();
    }

    function _requireAdmin() private view {
        if (msg.sender != owner() && msg.sender != arbiter) revert NotAdmin();
    }

    /// @dev Entry-only eligibility gate; never applied to an existing trade, settlement or withdrawal.
    function _requireEligible(address account) internal view {
        if (paused) revert EnforcedPause();
        if (restricted[account] || isDisputeLimitReached(account)) revert Restricted();
        if (totalDebt[account] != 0) revert DebtOutstanding();
        if (block.timestamp < penalties[account].bannedUntil) revert CooldownActive();
        if (kycRequired && !isVerified(account)) revert NotVerified();
    }

    function _startReview(uint256 orderId, Order storage order) private {
        if (msg.sender != arbiter && msg.sender != backupArbiter) revert Unauthorized();
        OrderStatus st = order.status;
        if (st != OrderStatus.Paid && st != OrderStatus.Disputed) revert InvalidStatus(st);
        if (msg.sender == order.buyer || msg.sender == order.seller) revert ArbiterIsParty();
        unchecked {
            if (order.disputedAt == 0 && block.timestamp < uint256(order.paidAt) + 15 minutes) {
                revert TooEarly();
            }
            if (msg.sender != arbiter) {
                uint256 anchor = order.disputedAt != 0 ? order.disputedAt : order.paidAt;
                if (block.timestamp < anchor + BACKUP_ARBITER_DELAY) revert TooEarly();
            }
        }
        uint64 nowTs = uint64(block.timestamp);
        if (order.disputedAt == 0) {
            order.disputedAt = nowTs;
            emit OrderDisputed(orderId, msg.sender, nowTs);
        }
        if (order.reviewStartedAt == 0) {
            order.reviewStartedAt = nowTs;
        }
    }

    function _settleDisputed(uint256 orderId, Order storage order, address conceder, address recipient) private {
        _finish(order, OrderStatus.Settled);
        Stats storage s = stats[conceder];
        uint32 oldEff = _effectiveLosses(s);
        unchecked {
            ++s.disputesSettled;
            if (order.reviewStartedAt != 0) {
                ++s.disputesLost;
            } else if (block.timestamp > uint256(order.disputedAt) + COOLING_OFF) {
                ++s.concessions;
            }
        }
        _checkClearWaiver(conceder, s, oldEff);
        emit DisputeSettled(orderId, conceder, recipient, order.amount);
        _payout(recipient, order.amount);
    }

    function _effectiveLosses(Stats storage s) private view returns (uint32) {
        unchecked {
            return s.disputesLost + (s.concessions / 2);
        }
    }

    function _lossLimit(Stats storage s) private view returns (uint32) {
        return s.ordersCompleted < BUY_AD_MIN_COMPLETED ? 1 : 2;
    }

    function _checkClearWaiver(address account, Stats storage s, uint32 oldEff) private {
        if (disputeLimitWaived[account]) {
            uint32 newEff = _effectiveLosses(s);
            if (newEff > oldEff && newEff >= _lossLimit(s)) {
                disputeLimitWaived[account] = false;
                emit DisputeWaiverUpdated(account, false);
            }
        }
    }

    function _requireMessageSender(Order storage order) private view {
        OrderStatus st = order.status;
        if (st != OrderStatus.Pending && st != OrderStatus.Paid && st != OrderStatus.Disputed) {
            revert InvalidStatus(st);
        }
        if (msg.sender == order.buyer || msg.sender == order.seller) return;
        if (st == OrderStatus.Disputed) {
            if (msg.sender == arbiter) return;
            unchecked {
                if (
                    msg.sender == backupArbiter
                        && block.timestamp >= uint256(order.disputedAt) + BACKUP_ARBITER_DELAY
                ) {
                    return;
                }
            }
        }
        revert Unauthorized();
    }

    function _tierOf(address account) private view returns (uint8 tier, uint256 cap) {
        Stats storage s = stats[account];
        unchecked {
            uint256 age = s.firstSeen != 0 && block.timestamp >= s.firstSeen ? block.timestamp - s.firstSeen : 0;
            if (s.ordersCompleted >= 20 && age >= TIER3_MIN_AGE) {
                tier = 3;
            } else if (s.ordersCompleted >= 5 && age >= TIER2_MIN_AGE) {
                tier = 2;
            } else if (s.ordersCompleted >= 1) {
                tier = 1;
            }
            if (tier < 3 && isVerified(account) && verification[account].level >= 2) {
                ++tier;
            }
            if (tier < 1 && isMerchant(account)) {
                tier = 1;
            }
        }
        if (tier == 3) {
            cap = type(uint256).max;
        } else {
            unchecked {
                uint256 du = DOLLAR_UNIT;
                cap = tier == 2 ? du * 2_000 : (tier == 1 ? du * 500 : du * 200);
            }
        }
    }

    function _touchFirstSeen(address account) private {
        if (stats[account].firstSeen == 0) {
            stats[account].firstSeen = uint64(block.timestamp);
        }
    }

    function _repayDebtFromEscrow(address debtor, uint256 budget) private {
        P2PEscrowDebtLib.repay(debtor, budget, address(usdc), _debts, totalDebt, claimable);
    }

    /// @dev Buyer cancellations in Pending (when buyer == taker and detailsReady) add a strike.
    function _addStrike(address buyer) private {
        Penalty storage penalty = penalties[buyer];
        unchecked {
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
    }

    function _validatePrice(uint128 priceE6) private pure {
        if (priceE6 == 0 || priceE6 > 1e15) revert InvalidPrice();
    }

    function _copyOrder(Order storage order) private view returns (Order memory m) {
        m = order;
        Ad storage ad = _ads[m.adId];
        if (ad.side == Side.Sell && ad.detailsMode == DETAILS_PLAIN) {
            m.paymentDetails = ad.details;
        }
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

    function _pullUsdc(address from, uint256 amount) private {
        address token = address(usdc);
        bool ok;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x23b872dd00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), and(from, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x24), address())
            mstore(add(ptr, 0x44), amount)
            let s := call(gas(), token, 0, ptr, 0x64, 0x00, 0x20)
            ok := and(s, or(iszero(returndatasize()), and(gt(returndatasize(), 0x1f), eq(mload(0x00), 1))))
        }
        if (!ok) revert SafeERC20FailedOperation(token);
    }

    function _tryTransfer(address to, uint256 amount, bool strictErc20) private returns (bool ok) {
        address token = address(usdc);
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x24), amount)
            let s := call(gas(), token, 0, ptr, 0x44, 0x00, 0x20)
            let hasTrue := and(gt(returndatasize(), 0x1f), eq(mload(0x00), 1))
            ok := and(s, or(and(iszero(strictErc20), iszero(returndatasize())), hasTrue))
        }
    }

    function _pushUsdc(address to, uint256 amount) private {
        if (!_tryTransfer(to, amount, false)) revert SafeERC20FailedOperation(address(usdc));
    }

    function _payout(address to, uint256 amount) internal {
        if (!_tryTransfer(to, amount, true)) {
            unchecked {
                claimable[to] += amount;
            }
            emit PayoutDeferred(to, amount);
        }
    }

    function _finish(Order storage order, OrderStatus terminalStatus) private {
        order.status = terminalStatus;
        unchecked {
            --openOrderCount[order.taker];
            --partyOpenOrders[order.buyer];
            --partyOpenOrders[order.seller];
        }
    }

    function _setCurrency(bytes3 currency, bool supported) private {
        supportedCurrency[currency] = supported;
        emit CurrencyUpdated(currency, supported);
    }
}

library P2PEscrowDebtLib {
    event MarginSlashed(uint256 indexed orderId, address indexed loser, address indexed winner, uint256 amount);
    event DebtCreated(uint256 indexed orderId, address indexed debtor, address indexed creditor, uint128 amount);
    event DebtRepaid(address indexed debtor, address indexed creditor, uint256 amount);
    event PayoutDeferred(address indexed to, uint256 amount);

    function applyRuling(
        uint256 orderId,
        P2PEscrow.Order storage order,
        address loser,
        address recipient,
        bool slashLoser,
        bool applyBond,
        mapping(address => uint256) storage margin,
        mapping(address => P2PEscrow.MarginWithdrawal) storage marginWithdrawal,
        mapping(address => P2PEscrow.Debt[]) storage debtsMap,
        mapping(address => uint256) storage totalDebt
    ) external returns (uint256 extra) {
        uint256 bondFromMargin;
        if (applyBond) {
            uint256 bond = order.bond;
            uint256 bal = margin[loser];
            uint256 pend = marginWithdrawal[loser].amount;
            uint256 free;
            unchecked {
                free = bal - (pend < bal ? pend : bal);
            }
            bondFromMargin = free < bond ? free : bond;
            uint256 bondDebt;
            unchecked {
                bondDebt = bond - bondFromMargin;
                if (bondFromMargin != 0) margin[loser] -= bondFromMargin;
            }
            if (bondDebt != 0) {
                _recordDebt(loser, recipient, uint128(bondDebt), debtsMap, totalDebt);
                emit DebtCreated(orderId, loser, recipient, uint128(bondDebt));
            }
        }

        uint256 slash;
        if (slashLoser) {
            slash = margin[loser] < order.amount ? margin[loser] : order.amount;
            unchecked {
                margin[loser] -= slash;
            }
            P2PEscrow.MarginWithdrawal storage pending = marginWithdrawal[loser];
            if (pending.amount > margin[loser]) pending.amount = uint128(margin[loser]);
            emit MarginSlashed(orderId, loser, recipient, slash);
        }

        unchecked {
            extra = bondFromMargin + slash;
        }
    }

    function _recordDebt(
        address debtor,
        address creditor,
        uint128 amount,
        mapping(address => P2PEscrow.Debt[]) storage debtsMap,
        mapping(address => uint256) storage totalDebt
    ) private {
        P2PEscrow.Debt[] storage debts = debtsMap[debtor];
        unchecked {
            totalDebt[debtor] += amount;
            uint256 len = debts.length;
            if (len < 8) {
                debts.push(P2PEscrow.Debt({creditor: creditor, amount: amount}));
                return;
            }
            for (uint256 i = len; i > 0; --i) {
                if (debts[i - 1].creditor == creditor) {
                    debts[i - 1].amount += amount;
                    return;
                }
            }
            debts[0].amount += amount;
        }
    }

    function repay(
        address debtor,
        uint256 budget,
        address token,
        mapping(address => P2PEscrow.Debt[]) storage debtsMap,
        mapping(address => uint256) storage totalDebt,
        mapping(address => uint256) storage claimable
    ) external {
        P2PEscrow.Debt[] storage debts = debtsMap[debtor];
        uint256 len = debts.length;
        uint256 spent;
        uint256 popped;
        unchecked {
            while (popped < len && spent < budget) {
                address cred = debts[popped].creditor;
                uint128 owed = debts[popped].amount;
                uint256 rem = budget - spent;
                uint128 pay = rem >= owed ? owed : uint128(rem);
                spent += pay;
                totalDebt[debtor] -= pay;
                if (pay == owed) {
                    ++popped;
                } else {
                    debts[popped].amount = owed - pay;
                }
                emit DebtRepaid(debtor, cred, pay);
                bool ok;
                assembly ("memory-safe") {
                    let ptr := mload(0x40)
                    mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
                    mstore(add(ptr, 0x04), and(cred, 0xffffffffffffffffffffffffffffffffffffffff))
                    mstore(add(ptr, 0x24), pay)
                    let s := call(gas(), token, 0, ptr, 0x44, 0x00, 0x20)
                    ok := and(s, and(gt(returndatasize(), 0x1f), eq(mload(0x00), 1)))
                }
                if (!ok) {
                    claimable[cred] += pay;
                    emit PayoutDeferred(cred, pay);
                }
            }
            if (popped != 0) {
                uint256 remaining = len - popped;
                for (uint256 i; i < remaining; ++i) debts[i] = debts[i + popped];
                while (popped != 0) {
                    debts.pop();
                    --popped;
                }
            }
        }
    }
}
