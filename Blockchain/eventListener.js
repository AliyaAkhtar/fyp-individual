require("dotenv").config();
const { ethers } = require("ethers");
const Qexecution = require("../Controllers/query");

// ── Guard: skip everything if blockchain isn't configured ────────────────────
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;
const isConfigured =
  SEPOLIA_RPC_URL &&
  !SEPOLIA_RPC_URL.includes("YOUR_INFURA") &&
  process.env.OFFSET_PROJECT_REGISTRY &&
  !process.env.OFFSET_PROJECT_REGISTRY.includes("Your");

if (!isConfigured) {
  console.warn("[EventListener] Blockchain not configured — event listener disabled.");
  module.exports = {};
  return; // exit this module early
}

// ── Provider ─────────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);

// ── ABI loading (Hardhat artifact or raw array) ───────────────────────────────
function loadAbi(path) {
  const artifact = require(path);
  return artifact.abi || artifact;
}

const OffsetProjectRegistryABI = loadAbi("./abi/OffsetProjectRegistry.json");
const EmitterRegistryABI       = loadAbi("./abi/EmitterRegistry.json");
const MarketplaceABI           = loadAbi("./abi/CarbonCreditMarketplace.json");

// ── Contract instances ────────────────────────────────────────────────────────
const offsetRegistry = new ethers.Contract(
  process.env.OFFSET_PROJECT_REGISTRY,
  OffsetProjectRegistryABI,
  provider
);
const emitterRegistry = new ethers.Contract(
  process.env.EMITTER_REGISTRY,
  EmitterRegistryABI,
  provider
);
const marketplace = new ethers.Contract(
  process.env.MARKETPLACE,
  MarketplaceABI,
  provider
);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getBlockTimestamp(event) {
  const block = await provider.getBlock(event.blockNumber);
  return block.timestamp;
}

async function getProjectOwnerId(wallet) {
  const [rows] = await Qexecution.queryExecute(
    `SELECT owner_id FROM project_owners WHERE wallet_address = ?`,
    [wallet]
  );
  return rows.length ? rows[0].owner_id : null;
}

async function getIndustryId(wallet) {
  const [rows] = await Qexecution.queryExecute(
    `SELECT industry_id FROM industries WHERE wallet_address = ?`,
    [wallet]
  );
  return rows.length ? rows[0].industry_id : null;
}

async function getNormalUserId(wallet) {
  const [rows] = await Qexecution.queryExecute(
    `SELECT user_id FROM normal_users WHERE wallet_address = ?`,
    [wallet]
  );
  return rows.length ? rows[0].user_id : null;
}

// ── Event Listeners ───────────────────────────────────────────────────────────

offsetRegistry.on("ProjectRegistered", async (projectId, ownerWallet, metadataCID, event) => {
  try {
    const timestamp = await getBlockTimestamp(event);
    const ownerId = await getProjectOwnerId(ownerWallet);
    if (!ownerId) return;

    await Qexecution.queryExecute(
      `INSERT IGNORE INTO projects
       (project_id, owner_id, image_url, verification_status, created_at)
       VALUES (?, ?, ?, 'pending', FROM_UNIXTIME(?))`,
      [projectId.toString(), ownerId, metadataCID, timestamp]
    );
    console.log("[EventListener] ProjectRegistered synced:", projectId.toString());
  } catch (err) {
    console.error("[EventListener] ProjectRegistered error:", err.message);
  }
});

offsetRegistry.on("CreditsIssued", async (projectId, amount, toWallet, event) => {
  try {
    const timestamp = await getBlockTimestamp(event);
    const ownerId = await getProjectOwnerId(toWallet);
    if (!ownerId) return;

    const [result] = await Qexecution.queryExecute(
      `INSERT INTO tokens
       (project_id, owner_user_id, amount, minted_at)
       VALUES (?, ?, ?, FROM_UNIXTIME(?))`,
      [projectId.toString(), ownerId, amount.toString(), timestamp]
    );

    await Qexecution.queryExecute(
      `INSERT INTO token_transactions
       (token_id, tx_type, amount, timestamp)
       VALUES (?, 'minted', ?, FROM_UNIXTIME(?))`,
      [result.insertId, amount.toString(), timestamp]
    );
    console.log("[EventListener] CreditsIssued synced:", amount.toString());
  } catch (err) {
    console.error("[EventListener] CreditsIssued error:", err.message);
  }
});

emitterRegistry.on("EmissionsOffset", async (emitterWallet, amount, event) => {
  try {
    const timestamp = await getBlockTimestamp(event);
    const industryId = await getIndustryId(emitterWallet);
    if (!industryId) return;

    await Qexecution.queryExecute(
      `INSERT INTO offsets
       (industry_id, co2_offset_value, issued_tokens, created_at)
       VALUES (?, ?, ?, FROM_UNIXTIME(?))`,
      [industryId, amount.toString(), amount.toString(), timestamp]
    );

    await Qexecution.queryExecute(
      `INSERT INTO token_transactions
       (tx_type, amount, buyer_industry_id, timestamp)
       VALUES ('retired', ?, ?, FROM_UNIXTIME(?))`,
      [amount.toString(), industryId, timestamp]
    );
    console.log("[EventListener] EmissionsOffset synced:", amount.toString());
  } catch (err) {
    console.error("[EventListener] EmissionsOffset error:", err.message);
  }
});

marketplace.on("ListingCreated", async (orderId, sellerWallet, tokenId, amount, price, event) => {
  try {
    const timestamp = await getBlockTimestamp(event);
    const chainId = orderId.toString();

    // Landowner / project-owner path
    const ownerId = await getProjectOwnerId(sellerWallet);
    if (ownerId) {
      await Qexecution.queryExecute(
        `INSERT IGNORE INTO marketplace
         (order_id, chain_listing_id, registration_id, order_type, amount, price, status, created_at)
         VALUES (?, ?, ?, 'sell', ?, ?, 'open', FROM_UNIXTIME(?))`,
        [chainId, chainId, ownerId, amount.toString(), price.toString(), timestamp]
      );
      // Landowner frontend creates a preliminary DB row before signing; the row stores
      // amount+price in the same wei units the contract uses, so we can match on them.
      await Qexecution.queryExecute(
        `UPDATE marketplace SET chain_listing_id = ? WHERE chain_listing_id IS NULL AND amount = ? AND price = ? AND status = 'open' ORDER BY order_id DESC LIMIT 1`,
        [chainId, amount.toString(), price.toString()]
      );
      console.log("[EventListener] ListingCreated (owner) synced:", chainId);
      return;
    }

    // Individual-user path — match by user_id, not by amount/price (units differ: DB stores
    // raw decimals & PKR, the contract stores wei-scaled values so they never match directly).
    const normalUserId = await getNormalUserId(sellerWallet);
    if (normalUserId) {
      await Qexecution.queryExecute(
        `UPDATE marketplace SET chain_listing_id = ? WHERE chain_listing_id IS NULL AND user_id = ? AND status = 'open' ORDER BY order_id DESC LIMIT 1`,
        [chainId, normalUserId]
      );
      console.log("[EventListener] ListingCreated (individual) synced:", chainId);
      return;
    }

    console.warn("[EventListener] ListingCreated: seller wallet not found in DB:", sellerWallet);
  } catch (err) {
    console.error("[EventListener] ListingCreated error:", err.message);
  }
});

marketplace.on("ListingPurchased", async (orderId, buyerWallet, event) => {
  try {
    const industryId = await getIndustryId(buyerWallet);
    if (!industryId) return;

    await Qexecution.queryExecute(
      `UPDATE marketplace SET status = 'completed' WHERE order_id = ?`,
      [orderId.toString()]
    );
    console.log("[EventListener] ListingPurchased synced:", orderId.toString());
  } catch (err) {
    console.error("[EventListener] ListingPurchased error:", err.message);
  }
});

marketplace.on("ListingCancelled", async (orderId) => {
  try {
    await Qexecution.queryExecute(
      `UPDATE marketplace SET status = 'cancelled' WHERE order_id = ?`,
      [orderId.toString()]
    );
    console.log("[EventListener] ListingCancelled synced:", orderId.toString());
  } catch (err) {
    console.error("[EventListener] ListingCancelled error:", err.message);
  }
});

console.log("[EventListener] Blockchain event listener active on Sepolia.");
module.exports = {};
