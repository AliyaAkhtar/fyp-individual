const express = require("express");
const GovController = require("../Controllers/GovernmentController");

const router = express.Router();

router.route('/dashboard')
    .get(GovController.getDashboardStats);

router.route('/pending')
    .get(GovController.getPendingApprovals);

router.route('/industries')
    .get(GovController.getIndustries);

router.route('/industry/:id')
    .get(GovController.getIndustryDetails);

router.route('/landonwers')
    .get(GovController.getLandowners);

router.route('/approve')
    .patch(GovController.updateApprovalStatus);

// POST /government/approveIndustry – approve or reject an industry (by industry_id)
router.route('/approveIndustry')
    .post(GovController.approveIndustry);

// POST /government/approveLandowner – approve or reject a landowner (by owner_id)
router.route('/approveLandowner')
    .post(GovController.approveLandowner);

// POST /government/approveProject – approve or reject a project (by project_id)
router.route('/approveProject')
    .post(GovController.approveProject);

// GET /government/projects – list all offset projects
router.route('/projects')
    .get(GovController.getAllProjects);

// ── Blockchain routes (admin wallet) ─────────────────────────────────────────
// POST /government/blockchain/verify-project   { project_id }
router.route('/blockchain/verify-project')
    .post(GovController.verifyProject);

// POST /government/blockchain/revoke-project   { project_id }
router.route('/blockchain/revoke-project')
    .post(GovController.revokeProject);

// POST /government/blockchain/mint-credits     { project_id, amount }
router.route('/blockchain/mint-credits')
    .post(GovController.mintCredits);

module.exports = router;
