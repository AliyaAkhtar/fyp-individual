require("dotenv").config();
const { ethers } = require("ethers");

// ── Helpers ──────────────────────────────────────────────────────────────────
function isValidPrivateKey(val) {
  if (!val || typeof val !== "string") return false;
  const hex = val.startsWith("0x") ? val.slice(2) : val;
  return /^[0-9a-fA-F]{64}$/.test(hex);
}

function isValidAddress(val) {
  if (!val || typeof val !== "string") return false;
  return /^0x[0-9a-fA-F]{40}$/.test(val);
}

function isPlaceholder(val) {
  if (!val) return true;
  const lower = val.toLowerCase();
  return (
    lower.includes("your_") ||
    lower.includes("yourinfura") ||
    lower.includes("infura_project_id") ||
    lower === ""
  );
}

// ── Provider (needed for admin-wallet writes and event listeners) ───────────

let provider = null;
try {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (rpcUrl && !isPlaceholder(rpcUrl)) {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    console.log("[Blockchain] Provider connected to Sepolia.");
  } else {
    console.warn("[Blockchain] SEPOLIA_RPC_URL not configured — read/admin features disabled. buildTxData still works.");
  }
} catch (err) {
  console.warn("[Blockchain] Failed to create provider:", err.message);
}

// ── ABI imports ────────────────────────────────────────────────────────────────────

let GreenCreditTokenABI, EmitterRegistryABI, OffsetProjectRegistryABI, MarketplaceABI;
try {
  const _gct  = require("./abi/GreenCreditToken.json");
  const _er   = require("./abi/EmitterRegistry.json");
  const _opr  = require("./abi/OffsetProjectRegistry.json");
  const _mp   = require("./abi/CarbonCreditMarketplace.json");

  GreenCreditTokenABI      = _gct.abi  || _gct;
  EmitterRegistryABI       = _er.abi   || _er;
  OffsetProjectRegistryABI = _opr.abi  || _opr;
  MarketplaceABI           = _mp.abi   || _mp;
} catch (err) {
  console.warn("[Blockchain] Failed to load ABI files:", err.message);
}

// ── Admin signer ──────────────────────────────────────────────────────────────────────

let adminWallet = null;
if (isValidPrivateKey(process.env.ADMIN_PRIVATE_KEY)) {
  try {
    adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
    console.log("[Blockchain] Admin wallet loaded:", adminWallet.address);
  } catch (err) {
    console.warn("[Blockchain] Failed to create admin wallet:", err.message);
  }
} else if (process.env.ADMIN_PRIVATE_KEY) {
  console.warn("[Blockchain] ADMIN_PRIVATE_KEY is set but invalid — admin wallet disabled.");
} else {
  console.warn("[Blockchain] ADMIN_PRIVATE_KEY not set — admin wallet disabled.");
}

// ── Contract factory helpers ─────────────────────────────────────────────────────

/**
 * Full contract instance (needs a live provider or signer).
 * Used for admin-wallet writes and event listeners.
 */
function makeContract(envAddress, abi, signerOrProvider) {
  if (!isValidAddress(envAddress)) return null;
  if (!abi || !signerOrProvider) return null;
  try {
    return new ethers.Contract(envAddress, abi, signerOrProvider);
  } catch (err) {
    console.warn("[Blockchain] Failed to create contract:", err.message);
    return null;
  }
}

/**
 * Encoding-only contract stub — NO provider required.
 * Has .interface (for encodeFunctionData) and .getAddress() only.
 * Used exclusively by buildTxData so tx encoding always works even without RPC.
 */
function makeEncodingStub(envAddress, abi) {
  if (!isValidAddress(envAddress)) return null;
  if (!abi) return null;
  try {
    const iface = new ethers.Interface(abi);
    return {
      interface: iface,
      getAddress: () => Promise.resolve(envAddress),
    };
  } catch (err) {
    console.warn("[Blockchain] Failed to create encoding stub:", err.message);
    return null;
  }
}

// ── Live contract instances (provider-backed, may be null if no RPC) ─────────

const greenCreditToken = makeContract(
  process.env.GREEN_CREDIT_TOKEN, GreenCreditTokenABI, provider
);
const emitterRegistry = makeContract(
  process.env.EMITTER_REGISTRY, EmitterRegistryABI, provider
);
const offsetProjectRegistry = makeContract(
  process.env.OFFSET_PROJECT_REGISTRY, OffsetProjectRegistryABI, provider
);
const marketplace = makeContract(
  process.env.MARKETPLACE, MarketplaceABI, provider
);

// ── Encoding-only stubs (always available as long as addresses + ABIs are set) ─

const encGreenCreditToken = makeEncodingStub(
  process.env.GREEN_CREDIT_TOKEN, GreenCreditTokenABI
);
const encEmitterRegistry = makeEncodingStub(
  process.env.EMITTER_REGISTRY, EmitterRegistryABI
);
const encOffsetProjectRegistry = makeEncodingStub(
  process.env.OFFSET_PROJECT_REGISTRY, OffsetProjectRegistryABI
);
const encMarketplace = makeEncodingStub(
  process.env.MARKETPLACE, MarketplaceABI
);

// ── Admin-signed instances (requires provider + adminWallet) ─────────────────

function getAdminContracts() {
  if (!adminWallet) {
    throw new Error("Admin wallet not configured. Set ADMIN_PRIVATE_KEY in .env");
  }
  if (!provider) {
    throw new Error("RPC provider not configured. Set SEPOLIA_RPC_URL in .env");
  }
  if (!greenCreditToken || !emitterRegistry || !offsetProjectRegistry || !marketplace) {
    throw new Error("Contract addresses not configured. Set contract addresses in .env");
  }
  return {
    greenCreditToken:      greenCreditToken.connect(adminWallet),
    emitterRegistry:       emitterRegistry.connect(adminWallet),
    offsetProjectRegistry: offsetProjectRegistry.connect(adminWallet),
    marketplace:           marketplace.connect(adminWallet),
  };
}

// ── buildTxData: encode unsigned tx for MetaMask signing ────────────────────
// Uses encoding stubs — works even when SEPOLIA_RPC_URL is not configured.

async function buildTxData(contractOrStub, method, args = []) {
  if (!contractOrStub) {
    throw new Error(
      "Contract encoding stub not available — check that contract addresses and ABI files are correct in .env"
    );
  }
  const data = contractOrStub.interface.encodeFunctionData(method, args);
  const to   = await contractOrStub.getAddress();
  return { to, data, value: "0x0" };
}

// Convenience: build tx data using encoding stubs (always use these from controllers)
const enc = {
  greenCreditToken:      encGreenCreditToken,
  emitterRegistry:       encEmitterRegistry,
  offsetProjectRegistry: encOffsetProjectRegistry,
  marketplace:           encMarketplace,
};

module.exports = {
  provider,
  adminWallet,
  // Live contracts (provider-backed)
  greenCreditToken,
  emitterRegistry,
  offsetProjectRegistry,
  marketplace,
  // Encoding stubs (always available)
  enc,
  getAdminContracts,
  buildTxData,
  GreenCreditTokenABI,
  EmitterRegistryABI,
  OffsetProjectRegistryABI,
  MarketplaceABI,
};
