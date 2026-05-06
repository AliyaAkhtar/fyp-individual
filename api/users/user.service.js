// const pool = require('./../../config/database')
// const Qexecution = require('./../../Controllers/query')
// const crypto = require('crypto');
// const bcrypt = require('bcrypt');

// module.exports= {
//     create: (data, callBack) => {
//         pool.query(
//             `SELECT * FROM registrations WHERE email = ?`,
//             [data.email],
//             (error, results) => {
//                 if (error) {
//                     return callBack(error);
//                 }
//                 if (results.length > 0) {
//                     // Email already exists
//                     return callBack(null, { message: "Email already registered." });
//                 } else {
//                     // Insert into the respective table first
//                     let insertQuery = '';
//                     let insertValues = [];

//                     if (data.role === 'Client') {
//                         insertQuery = `INSERT INTO client(name, phoneNumber, email, companyName) VALUES (?,?,?,?)`;
//                         insertValues = [data.name, data.phoneNumber, data.email, data.companyName];
//                     } 
//                     else if (data.role === 'Employee') {
//                         insertQuery = `INSERT INTO employees(name, email, phoneNumber, role, status, skills, experience) VALUES (?,?,?,?,?,?,?)`;
//                         insertValues = [
//                             data.name,
//                             data.email,
//                             data.phoneNumber,
//                             data.role,
//                             'active', // default status
//                             data.skills,
//                             data.experience
//                         ];
//                     } 
//                     else if (data.role === 'PM') {
//                         insertQuery = `INSERT INTO projectmanager(name, email, phoneNumber) VALUES (?,?,?)`;
//                         insertValues = [data.name, data.email, data.phoneNumber];
//                     } 
//                     else if (data.position === 'BA') {
//                         insertQuery = `INSERT INTO businessanalyst(name, email, phoneNumber, experience) VALUES (?,?,?,?)`;
//                         insertValues = [data.name, data.email, data.phoneNumber, data.experience];
//                     } 
//                     else {
//                         return callBack(null, { message: "Invalid position specified." });
//                     }

//                     // Now insert into the respective table
//                     pool.query(
//                         insertQuery,
//                         insertValues,
//                         (error, results1) => {
//                             if (error) {
//                                 return callBack(error);
//                             }

//                             // After successful insertion, insert into registration
//                             pool.query(
//                                 `INSERT INTO registrations(email, password, position) VALUES (?,?,?)`,
//                                 [data.email, data.password, data.position],
//                                 (error, results2) => {
//                                     if (error) {
//                                         return callBack(error);
//                                     }
//                                     return callBack(null, { message: "User registered successfully." });
//                                 }
//                             );
//                         }
//                     );
//                 }
//             }
//         );
//     },  
//     getUserByEmail: async (email,callBack)=>{
//         const SQL= "SELECT * FROM registrations where email= ?";
//         try{
//             const result=await Qexecution.queryExecute(SQL,[email, 1]);
//             return callBack(null,result[0]);
//         }catch(err){
//             return callBack(err);
//         }
//     },
//     checkIfLoggedInByToken: async (token,req,res)=>{
//         const SQL= "SELECT * FROM session";
//         const encrypted=crypto.createHash('sha256').update(token).digest('hex');
//         try{
//             const result= await Qexecution.queryExecute(SQL);
//             const tokens= result.map(data=> data.token)
//             if(tokens.includes(encrypted)) {
//                 console.log('true');
//                 return true
//             }else{
//                 console.log('false');
//                 return false;
//             }
//         }catch(err){
//             return res.json({
//                 status: "fail",
//                 message: err.message
//             });
//         }
//     },
//     resetPwd: async (updatedPwd,email,callBack)=>{
//         const SQL= "UPDATE registration SET password = ? WHERE email=?";
//         try{
//             const result = await Qexecution.queryExecute(SQL,[updatedPwd,email]);
//             return callBack(null,result);
//         }catch(err){
//             return callBack(err);
//         }
//     },

//     loginSession: async (token,email,callBack)=>{
//         const SQL="INSERT INTO session VALUES(?,?)";
//         try{
//             const result= await Qexecution.queryExecute(SQL,[email,token]);
//             return callBack(null,result)
//         }
//         catch(err){
//             return callBack(err);
//         }
//     },
//     checkIfLoggedInByEmail: async (email,req,res)=>{
//         const SQL= "SELECT * FROM session";
//         try{
//             const result= await Qexecution.queryExecute(SQL);
//             const emails= result.map(data=> data.email)
//             if(emails.includes(email)) {
//                 // console.log('true');
//                 const SQL2= "DELETE FROM session WHERE email=?"
//                 const result2= await Qexecution.queryExecute(SQL2,[email]);
//                 return;
//             }
//         }catch(err){
//             return res.json({
//                 status: "fail",
//                 message: err.message
//             });
//         }
//     },
//     logout: async (token,req,res)=>{
//         const SQL= "DELETE FROM session WHERE token=?";
//         try{
//             // console.log("token: ",token)
//             const result= await Qexecution.queryExecute(SQL,[token]);
//             if(result.affectedRows===0){
//                 throw Error('You aren\'t logged in' );
//             }
//             else{
//                 return res.status(200).json({
//                     status: "success",
//                     message: "Successfully logged out"
//                 });
//             }
//         }catch(err){
//             return res.status(400).json({
//                 status: "fail",
//                 message: err.message
//             });
//         }
//     }
// }



const pool = require('./../../config/database');
const Qexecution = require('./../../Controllers/query');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { uploadJSONToIPFS } = require("../../services/ipfsService");
const axios = require("axios");

module.exports = {
    // ======================
    // 1. Register New User
    // ======================
    create: (data, callBack) => {
        console.log(`[SIGNUP SERVICE] Starting registration. email=${data.email} role=${data.role}`);
        pool.query(
            `SELECT * FROM registrations WHERE email = ?`,
            [data.email],
            async (error, results) => {
                if (error) {
                    console.error('[SIGNUP SERVICE] DB error checking email:', error);
                    return callBack(error);
                }
                if (results.length > 0) {
                    console.log('[SIGNUP SERVICE] Email already registered:', data.email);
                    return callBack(null, { message: "Email already registered." });
                }

                console.log('[SIGNUP SERVICE] Email is new. Hashing password...');
                try {
                    // Hash the plain password
                    const hashedPwd = await bcrypt.hash(data.password, 10);
                    console.log('[SIGNUP SERVICE] Password hashed. Inserting into registrations...');

                    // Insert into central REGISTRATIONS table
                    pool.query(
                        `INSERT INTO registrations (email, password_hash, role, kyc_status) VALUES (?, ?, ?, ?)`,
                        [data.email, hashedPwd, data.role, false],
                        async (err, regResult) => {
                            if (err) { console.error('[SIGNUP SERVICE] Insert registrations error:', err); return callBack(err); }

                            const registrationId = regResult.insertId;
                            console.log(`[SIGNUP SERVICE] Registered in registrations table. registration_id=${registrationId} role=${data.role}`);

                            // INSERT INTO ROLE-SPECIFIC TABLE:
                            let roleQuery = '';
                            let roleValues = [];

                            switch (data.role) {
                                case 'normal_user':
                                    roleQuery = `
                                    INSERT INTO normal_users 
                                    (registration_id, name, household_size, house_area)
                                    VALUES (?, ?, ?, ?)`;
                                    roleValues = [
                                        registrationId,
                                        data.name,
                                        // data.wallet_address,
                                        data.household_size,
                                        data.house_area_sqm
                                    ];
                                    break;

                                case 'project_owner': {
                                    try {
                                        const metadata = {
                                            registration_id: registrationId,
                                            department_name: data.department_name,
                                            total_area: data.total_area,
                                            green_land: data.green_land,
                                            industry_area: data.industry_area,
                                            sector: data.sector || "general",
                                            production_tons: data.production_tons || 0,
                                            timestamp: new Date()
                                        };

                                        // Upload to IPFS
                                        const ipfsResponse = await axios.post(
                                            "https://api.pinata.cloud/pinning/pinJSONToIPFS",
                                            metadata,
                                            {
                                                headers: {
                                                    pinata_api_key: "5f3f92f9e2902f11d1d0",
                                                    pinata_secret_api_key: "34b934ab25e02d62769bfd8ca47541830ac0cad81b31388b083afb2cc8b63f27",
                                                },
                                            }
                                        );

                                        const metadataCID = ipfsResponse.data.IpfsHash;

                                        // Insert into project_owners
                                        pool.query(
                                            `INSERT INTO project_owners 
                                            (registration_id, department_name, total_area, green_land, industry_area, metadata_cid)
                                            VALUES (?, ?, ?, ?, ?, ?)`,
                                            [
                                                registrationId,
                                                data.department_name,
                                                data.total_area,
                                                data.green_land,
                                                data.industry_area,
                                                metadataCID
                                            ],
                                            (err, result) => {
                                                if (err) return callBack(err);

                                                // Insert into industries
                                                pool.query(
                                                    `INSERT INTO industries 
                                                    (registration_id, industry_name, sector, wallet_address, monthly_production_tons, area_sqft, metadata_cid)
                                                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                                    [
                                                        registrationId,
                                                        data.department_name,
                                                        data.sector || "general",
                                                        data.wallet_address || null,
                                                        data.production_tons || 0,
                                                        data.industry_area,
                                                        metadataCID
                                                    ],
                                                    (err2, result2) => {
                                                        if (err2) return callBack(err2);

                                                        return callBack(null, {
                                                            message: "Project owner + industry registered successfully",
                                                            registration_id: registrationId,
                                                            project_owner_id: result.insertId,
                                                            industry_id: result2.insertId,
                                                            metadataCID
                                                        });
                                                    }
                                                );
                                            }
                                        );

                                    } catch (err) {
                                        return callBack(err);
                                    }

                                    return; // 🔥🔥🔥 VERY IMPORTANT (prevents EMPTY QUERY)
                                }
                                case 'industry':
                                    try {
                                        console.log('[SIGNUP SERVICE] Industry role: uploading metadata to IPFS...');
                                        // 1. Build metadata for IPFS
                                        const metadata = {
                                            registration_id: registrationId,
                                            industry_name: data.industry_name,
                                            sector: data.sector,
                                            wallet_address: data.wallet_address,
                                            production_tons: data.production_tons,
                                            area_sqft: data.area_sqft,
                                            timestamp: new Date()
                                        };

                                        // 2. Upload to IPFS (Pinata)
                                        const ipfsResponse = await axios.post(
                                            "https://api.pinata.cloud/pinning/pinJSONToIPFS",
                                            metadata,
                                            {
                                                headers: {
                                                    pinata_api_key: "5f3f92f9e2902f11d1d0",
                                                    pinata_secret_api_key: "34b934ab25e02d62769bfd8ca47541830ac0cad81b31388b083afb2cc8b63f27",
                                                }
                                            }
                                        );

                                        const metadataCID = ipfsResponse.data.IpfsHash;
                                        console.log('[SIGNUP SERVICE] IPFS upload done. CID:', metadataCID);

                                        // 3. Store in DB
                                        roleQuery = `
                                        INSERT INTO industries
                                        (registration_id, industry_name, sector, wallet_address, monthly_production_tons, area_sqft, metadata_cid)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)`;

                                        roleValues = [
                                            registrationId,
                                            data.industry_name,
                                            data.sector,
                                            data.wallet_address,
                                            data.production_tons,
                                            data.area_sqft,
                                            metadataCID
                                        ];

                                    } catch (err) {
                                        return callBack(err);
                                    }
                                    break;

                                case 'gov':
                                    roleQuery = `
                                    INSERT INTO government_admins
                                    (registration_id, department_name, designation)
                                    VALUES (?, ?, ?)`;
                                    roleValues = [
                                        registrationId,
                                        data.department_name,
                                        data.designation
                                    ];
                                    break;

                                default:
                                    return callBack(null, { message: "Invalid role supplied." });
                            }

                            // Execute the role-specific INSERT
                            console.log(`[SIGNUP SERVICE] Inserting into role-specific table for role=${data.role}...`);
                            pool.query(roleQuery, roleValues, (roleErr) => {
                                if (roleErr) { console.error('[SIGNUP SERVICE] Role table insert error:', roleErr); return callBack(roleErr); }

                                console.log('[SIGNUP SERVICE] Role table insert success. Registration complete.');
                                return callBack(null, {
                                    message: "User registered successfully.",
                                    registration_id: registrationId,
                                    role: data.role
                                });
                            });
                        }
                    );
                } catch (err) {
                    return callBack(err);
                }
            }
        );
    },

    // ======================
    // 2. Get User by Email
    // ======================
    getUserByEmail: async (email, callBack) => {
        const SQL = "SELECT * FROM registrations WHERE email = ?";
        try {
            const result = await Qexecution.queryExecute(SQL, [email]);
            return callBack(null, result[0]);
        } catch (err) {
            return callBack(err);
        }
    },

    // ======================
    // 3. Login Session
    // ======================
    loginSession: async (token, registrationId, callBack) => {
        const SQL = "INSERT INTO session (registration_id, token) VALUES (?, ?)";
        try {
            const result = await Qexecution.queryExecute(SQL, [registrationId, token]);
            return callBack(null, result);
        } catch (err) {
            return callBack(err);
        }
    },

    // ======================
    // 4. Check Login by Token
    // ======================
    checkIfLoggedInByToken: async (token, req, res) => {
        const SQL = "SELECT * FROM session";
        const encrypted = crypto.createHash('sha256').update(token).digest('hex');
        try {
            const result = await Qexecution.queryExecute(SQL);
            const tokens = result.map(data => data.token);
            return tokens.includes(encrypted);
        } catch (err) {
            return res.json({
                status: "fail",
                message: err.message
            });
        }
    },

    // ======================
    // 5. Logout
    // ======================
    logout: async (token, req, res) => {
        const SQL = "DELETE FROM session WHERE token=?";
        try {
            const result = await Qexecution.queryExecute(SQL, [token]);
            if (result.affectedRows === 0) {
                throw Error("You aren't logged in");
            } else {
                return res.status(200).json({
                    status: "success",
                    message: "Successfully logged out"
                });
            }
        } catch (err) {
            return res.status(400).json({
                status: "fail",
                message: err.message
            });
        }
    },

    // ======================
    // 6. Reset Password
    // ======================
    resetPwd: async (updatedPwd, email, callBack) => {
        const SQL = "UPDATE registrations SET password_hash = ? WHERE email=?";
        try {
            const hashedPwd = await bcrypt.hash(updatedPwd, 10);
            const result = await Qexecution.queryExecute(SQL, [hashedPwd, email]);
            return callBack(null, result);
        } catch (err) {
            return callBack(err);
        }
    },

    // ======================
    // 7. Check Login by Email
    // ======================
    checkIfLoggedInByEmail: async (registrationId) => {
        const SQL = "SELECT * FROM session WHERE registration_id=?";
        try {
            const result = await Qexecution.queryExecute(SQL, [registrationId]);
            if (result.length > 0) {
                await Qexecution.queryExecute("DELETE FROM session WHERE registration_id=?", [registrationId]);
            }
        } catch (err) {
            throw err;
        }
    }
};
