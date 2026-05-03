const { ethers } = require("ethers");

const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);

module.exports = provider;
