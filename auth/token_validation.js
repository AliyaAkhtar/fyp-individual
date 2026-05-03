const { verify } = require("jsonwebtoken");
const { checkIfLoggedInByToken } = require('./../api/users/user.service');
const Qexecution = require('./../Controllers/query');

const roleQueries = {
    normal_user: "SELECT user_id AS roleId FROM normal_users WHERE registration_id = ? LIMIT 1",
    project_owner: "SELECT owner_id AS roleId FROM project_owners WHERE registration_id = ? LIMIT 1",
    industry: "SELECT industry_id AS roleId FROM industries WHERE registration_id = ? LIMIT 1",
    gov: "SELECT admin_id AS roleId FROM government_admins WHERE registration_id = ? LIMIT 1"
};

module.exports = {
    checkToken: (req, res, next) => {
        let token = req.headers.authorization;
        // console.log(token);
        // let id;

        if (token) {
            if (token.startsWith("Bearer ")) {
                token = token.slice(7);
            }
            // console.log(token);
            verify(token, "eraj20", async (err, decoded) => {
                if (err) {
                    console.log("done");
                    return res.status(400).json({
                        status: "fail",
                        message: "Invalid token"
                    });
                }
                

                try {
                    // console.log("done");
                    const ifLoggedIn = await checkIfLoggedInByToken(token, req, res);
                    // console.log("in validation",ifLoggedIn);
                    if (ifLoggedIn) {
                        const decodedUser = decoded?.result || {};
                        const registrationId = decodedUser.registration_id || decodedUser.id;
                        const query = roleQueries[decodedUser.role];
                        let roleId = registrationId;

                        if (query && registrationId) {
                            const rows = await Qexecution.queryExecute(query, [registrationId]);
                            roleId = rows?.[0]?.roleId || roleId;
                        }

                        req.user = {
                            ...decodedUser,
                            registration_id: registrationId,
                            roleId
                        };

                        next();
                    } else {
                        return res.status(400).json({
                            status: "fail",
                            message: "You are not logged in!"
                        });
                    }
                } catch (error) {
                    console.log(error);
                    return res.status(500).json({
                        status: "error",
                        message: "Internal server error"
                    });
                }
            });
        } else {
            return res.status(400).json({
                status: "fail",
                message: "Access denied"
            });
        }
    }
};