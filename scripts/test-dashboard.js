const axios = require("axios");

const BASE_URL = "http://localhost:2000/dashboard";

/* =========================
   CHANGE THESE BEFORE RUNNING
========================= */
const industry_id = 5;
const owner_id = 5;
const order_id = 4;

/* =========================
   HELPER
========================= */
const printSection = (title) => {
  console.log("\n==================================");
  console.log(title);
  console.log("==================================\n");
};

const callAPI = async (label, method, url, body = null) => {
  try {
    console.log(`🔹 ${label}`);

    let res;

    if (method === "GET") {
      res = await axios.get(url);
    } else if (method === "POST") {
      res = await axios.post(url, body || {});
    }

    console.log(res.data);
  } catch (err) {
    console.log("❌ ERROR:");
    console.log(err.response?.data || err.message);
  }

  console.log("\n----------------------------------\n");
};

/* =========================
   TEST ALL APIs
========================= */
const testAPIs = async () => {
  /* =========================
     INDUSTRY APIs
  ========================= */
  printSection("TESTING INDUSTRY APIs");

  await callAPI(
    "1. Process Industry Emissions",
    "POST",
    `${BASE_URL}/process-emissions/${industry_id}`
  );

  await callAPI(
    "2. Get Industry Details",
    "GET",
    `${BASE_URL}/industry-details/${industry_id}`
  );

  await callAPI(
    "3. Redeem Carbon Credits",
    "POST",
    `${BASE_URL}/redeem-credits/${industry_id}/2`
  );

  await callAPI(
    "4. Industry Monthly History",
    "GET",
    `${BASE_URL}/industry/${industry_id}/monthly-history`
  );

  /* =========================
     LANDOWNER APIs
  ========================= */
  printSection("TESTING LANDOWNER APIs");

  await callAPI(
    "5. Process Landowner Emissions",
    "POST",
    `${BASE_URL}/landowner/process-emissions/${owner_id}`
  );

  await callAPI(
    "6. Get Landowner Details",
    "GET",
    `${BASE_URL}/landowner/details/${owner_id}`
  );

  await callAPI(
    "7. Apply Landowner Offset",
    "POST",
    `${BASE_URL}/landowner/apply-offset/${owner_id}`
  );

  await callAPI(
    "8. Landowner Buy Credits",
    "POST",
    `${BASE_URL}/landowner/buy-credits/${owner_id}/5`,
  );

  await callAPI(
    "9. Owner Monthly History",
    "GET",
    `${BASE_URL}/owner/${owner_id}/monthly-history`
  );

  printSection("ALL TESTS COMPLETED");
};

testAPIs();