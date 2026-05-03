const Qexecution = require("./query");
const { getAdminContracts } = require("../Blockchain/contractService");

// ── Blockchain: Verify Project ────────────────────────────────────────────────
exports.verifyProject = async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) {
      return res.status(400).json({ status: "fail", message: "project_id required" });
    }

    const { offsetProjectRegistry } = getAdminContracts();
    const tx = await offsetProjectRegistry.verifyProject(project_id);
    await tx.wait();

    // Update DB status
    await Qexecution.queryExecute(
      `UPDATE projects SET verification_status = 'verified' WHERE project_id = ?`,
      [project_id]
    );

    res.json({ status: "success", message: "Project verified on-chain", txHash: tx.hash });
  } catch (err) {
    console.error("verifyProject error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── Blockchain: Revoke Project ────────────────────────────────────────────────
exports.revokeProject = async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) {
      return res.status(400).json({ status: "fail", message: "project_id required" });
    }

    const { offsetProjectRegistry } = getAdminContracts();
    const tx = await offsetProjectRegistry.revokeProject(project_id);
    await tx.wait();

    await Qexecution.queryExecute(
      `UPDATE projects SET verification_status = 'rejected' WHERE project_id = ?`,
      [project_id]
    );

    res.json({ status: "success", message: "Project revoked on-chain", txHash: tx.hash });
  } catch (err) {
    console.error("revokeProject error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── Blockchain: Mint Credits ──────────────────────────────────────────────────
exports.mintCredits = async (req, res) => {
  try {
    const { project_id, amount } = req.body;
    if (!project_id || !amount) {
      return res.status(400).json({ status: "fail", message: "project_id and amount required" });
    }

    const { offsetProjectRegistry } = getAdminContracts();
    const tx = await offsetProjectRegistry.mintCredits(project_id, amount);
    await tx.wait();

    // DB sync is handled by the CreditsIssued event listener
    res.json({ status: "success", message: "Credits minted on-chain", txHash: tx.hash });
  } catch (err) {
    console.error("mintCredits error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// Dashboard Summary
exports.getDashboardStats = async (req, res) => {
  try {
    const [industryCount] = await Qexecution.queryExecute(
      `SELECT COUNT(*) AS total FROM industries`
    );

    const [landownerCount] = await Qexecution.queryExecute(
      `SELECT COUNT(*) AS total FROM project_owners`
    );

    const [approvedCount] = await Qexecution.queryExecute(
      `SELECT COUNT(*) AS total 
       FROM registrations 
       WHERE kyc_status = 1`
    );

    const [pendingCount] = await Qexecution.queryExecute(
      `SELECT COUNT(*) AS total 
       FROM registrations 
       WHERE kyc_status = 0`
    );

    res.json({
      status: "success",
      stats: {
        total_industries: industryCount.total,
        total_landowners: landownerCount.total,
        total_approved: approvedCount.total,
        total_pending: pendingCount.total
      }
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Dashboard error" });
  }
};

// Pending Users (Industries + Landowners)
exports.getPendingApprovals = async (req, res) => {
  try {
    const pending = await Qexecution.queryExecute(
      `SELECT registration_id AS id, email, role, kyc_status
       FROM registrations
       WHERE kyc_status = 0`
    );

    res.json({
      status: "success",
      pending
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Error fetching pending users" });
  }
};

// Get All Industries (Summary View)
exports.getIndustries = async (req, res) => {
  try {
    const industries = await Qexecution.queryExecute(
      `SELECT 
         i.industry_id,
         i.industry_name,
         i.sector,
         r.email,
         r.kyc_status
       FROM industries i
       JOIN registrations r ON i.registration_id = r.registration_id`
    );

    res.json({
      status: "success",
      industries
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Error fetching industries" });
  }
};

// Get All Landowners
exports.getLandowners = async (req, res) => {
  try {
    const landowners = await Qexecution.queryExecute(
      `SELECT 
         p.owner_id AS id,
         COALESCE(p.department_name, p.designation, r.email) AS organization_name,
         p.department_name,
         p.designation,
         NULL AS total_land_area,
         NULL AS green_land_area,
         NULL AS location,
         r.email,
         r.kyc_status
       FROM project_owners p
       JOIN registrations r ON p.registration_id = r.registration_id`
    );

    res.json({
      status: "success",
      landowners
    });
  } catch (err) {
    console.error("getLandowners error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// Industry Full Detail (Action Button Click)
exports.getIndustryDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const [industry] = await Qexecution.queryExecute(
      `SELECT 
         i.*,
         r.email,
         r.kyc_status
       FROM industries i
       JOIN registrations r ON i.registration_id = r.registration_id
       WHERE i.industry_id = ?`,
      [id]
    );

    if (!industry || !industry[0]) {
      return res.status(404).json({
        status: "fail",
        message: "Industry not found"
      });
    }

    res.json({
      status: "success",
      industry: industry[0]
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Error fetching industry detail" });
  }
};

// ── Get All Projects (for blockchain management) ────────────────────────
exports.getAllProjects = async (req, res) => {
  try {
    const projects = await Qexecution.queryExecute(
      `SELECT
         p.project_id,
         p.project_name,
         p.verification_status,
         p.co2_saved,
         p.area,
         p.project_type,
         COALESCE(po.department_name, r.email) AS organization_name
       FROM projects p
       JOIN project_owners po ON p.owner_id = po.owner_id
       JOIN registrations r ON po.registration_id = r.registration_id
       ORDER BY p.project_id DESC`
    );
    res.json({ status: "success", projects });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Error fetching projects" });
  }
};

// Approve / Reject User (generic)
exports.updateApprovalStatus = async (req, res) => {
  try {
    const { registration_id, approve } = req.body;

    await Qexecution.queryExecute(
      `UPDATE registrations
       SET kyc_status = ?
       WHERE registration_id = ?`,
      [approve ? 1 : 0, registration_id]
    );

    res.json({
      status: "success",
      message: approve ? "Approved successfully" : "Rejected successfully"
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Approval update failed" });
  }
};

// POST /approveIndustry  { industry_id, status: "verified" | "rejected" }
exports.approveIndustry = async (req, res) => {
  try {
    const { industry_id, status } = req.body;
    if (!industry_id || !status) {
      return res.status(400).json({ status: "fail", message: "industry_id and status are required" });
    }

    // Get the registration_id + wallet_address for this industry
    const [industry] = await Qexecution.queryExecute(
      `SELECT registration_id, wallet_address FROM industries WHERE industry_id = ?`,
      [industry_id]
    );
    if (!industry) {
      return res.status(404).json({ status: "fail", message: "Industry not found" });
    }

    const kyc_status = status === "verified" ? 1 : 2;
    await Qexecution.queryExecute(
      `UPDATE registrations SET kyc_status = ? WHERE registration_id = ?`,
      [kyc_status, industry.registration_id]
    );

    let blockchainTxHash = null;
    // ── Blockchain: register emitter on approval ────────────────────────────
    if (status === "verified" && industry.wallet_address) {
      try {
        const { emitterRegistry } = getAdminContracts();
        const tx = await emitterRegistry.adminRegisterEmitter(industry.wallet_address);
        await tx.wait();
        blockchainTxHash = tx.hash;
        console.log(`[Blockchain] Industry emitter registered: ${industry.wallet_address}, tx: ${tx.hash}`);
      } catch (bcErr) {
        // Non-fatal: blockchain may not be configured in dev. DB is already updated.
        console.warn("[Blockchain] adminRegisterEmitter skipped:", bcErr.message);
      }
    }

    res.json({
      status: "success",
      message: status === "verified" ? "Approved successfully" : "Rejected successfully",
      ...(blockchainTxHash && { txHash: blockchainTxHash }),
    });
  } catch (err) {
    console.error("approveIndustry error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// POST /approveLandowner  { owner_id, status: "verified" | "rejected" }
exports.approveLandowner = async (req, res) => {
  try {
    const { owner_id, status } = req.body;
    if (!owner_id || !status) {
      return res.status(400).json({ status: "fail", message: "owner_id and status are required" });
    }

    // Get registration_id + wallet_address for this project_owner
    const [owner] = await Qexecution.queryExecute(
      `SELECT registration_id, wallet_address FROM project_owners WHERE owner_id = ?`,
      [owner_id]
    );
    if (!owner) {
      return res.status(404).json({ status: "fail", message: "Landowner not found" });
    }

    const kyc_status = status === "verified" ? 1 : 2;
    await Qexecution.queryExecute(
      `UPDATE registrations SET kyc_status = ? WHERE registration_id = ?`,
      [kyc_status, owner.registration_id]
    );

    let blockchainTxHash = null;
    // ── Blockchain: register emitter on approval ────────────────────────────
    if (status === "verified" && owner.wallet_address) {
      try {
        const { emitterRegistry } = getAdminContracts();
        const tx = await emitterRegistry.adminRegisterEmitter(owner.wallet_address);
        await tx.wait();
        blockchainTxHash = tx.hash;
        console.log(`[Blockchain] Landowner emitter registered: ${owner.wallet_address}, tx: ${tx.hash}`);
      } catch (bcErr) {
        console.warn("[Blockchain] adminRegisterEmitter skipped:", bcErr.message);
      }
    }

    res.json({
      status: "success",
      message: status === "verified" ? "Landowner approved successfully" : "Landowner rejected successfully",
      ...(blockchainTxHash && { txHash: blockchainTxHash }),
    });
  } catch (err) {
    console.error("approveLandowner error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// POST /approveProject  { project_id, status: "verified" | "rejected" }
// exports.approveProject = async (req, res) => {
//   try {
//     const { project_id, status } = req.body;
//     if (!project_id || !status) {
//       return res.status(400).json({ status: "fail", message: "project_id and status are required" });
//     }

//     await Qexecution.queryExecute(
//       `UPDATE projects SET verification_status = ? WHERE project_id = ?`,
//       [status === "verified" ? "verified" : "rejected", project_id]
//     );

//     res.json({ status: "success", message: status === "verified" ? "Project approved successfully" : "Project rejected successfully" });
//   } catch (err) {
//     console.error("approveProject error:", err.message);
//     res.status(500).json({ status: "fail", message: err.message });
//   }
// };


// POST /approveProject
// { project_id, status: "verified" | "rejected" }

const TON_PER_TOKEN = 10; // 1 token = 10 tons CO2

exports.approveProject = async (req, res) => {
  try {
    const { project_id, status } = req.body;

    if (!project_id || !status) {
      return res.status(400).json({
        status: "fail",
        message: "project_id and status are required"
      });
    }

    // 1. Get project details first
    const projectResult = await Qexecution.queryExecute(
      `SELECT project_id, owner_id, co2_saved, verification_status
       FROM projects
       WHERE project_id = ?`,
      [project_id]
    );

    const project = projectResult?.[0];

    if (!project) {
      return res.status(404).json({
        status: "fail",
        message: "Project not found"
      });
    }

    // ❗ Prevent double minting
    if (project.verification_status === "verified") {
      return res.status(400).json({
        status: "fail",
        message: "Project already verified"
      });
    }

    // 2. Update verification status
    const finalStatus = status === "verified" ? "verified" : "rejected";

    await Qexecution.queryExecute(
      `UPDATE projects SET verification_status = ? WHERE project_id = ?`,
      [finalStatus, project_id]
    );

    // ❌ If rejected → stop here
    if (finalStatus === "rejected") {
      return res.json({
        status: "success",
        message: "Project rejected successfully"
      });
    }

    // ================================
    // 3. TOKEN MINT LOGIC (IMPORTANT)
    // ================================

    const co2Saved = Number(project.co2_saved || 0);

    const tokensToMint = Math.floor(co2Saved / TON_PER_TOKEN);

    if (tokensToMint <= 0) {
      return res.json({
        status: "success",
        message: "Project verified but no tokens generated (insufficient CO2 savings)"
      });
    }

    // 5. Store tokens in DB
    await Qexecution.queryExecute(
      `INSERT INTO tokens (project_id, owner_id, amount)
       VALUES (?, ?, ?)`,
      [project_id, project.owner_id, tokensToMint]
    );

    // 6. Response
    res.json({
      status: "success",
      message: "Project verified and tokens minted successfully",
      data: {
        project_id,
        co2_saved: co2Saved,
        tokens_minted: tokensToMint,
        conversion_rule: "1 token = 10 tons CO2",
        // txHash: tx.hash
      }
    });

  } catch (err) {
    console.error("approveProject error:", err.message);
    res.status(500).json({
      status: "fail",
      message: err.message
    });
  }
};