const axios = require("axios");

PINATA_API_KEY="5f3f92f9e2902f11d1d0"
PINATA_SECRET_API_KEY="34b934ab25e02d62769bfd8ca47541830ac0cad81b31388b083afb2cc8b63f27"

exports.uploadJSONToIPFS = async (metadata) => {
  try {

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      metadata,
      {
        headers: {
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET_API_KEY
        }
      }
    );

    return response.data.IpfsHash;

  } catch (error) {
    console.error("IPFS Upload Error:", error.message);
    throw error;
  }
};