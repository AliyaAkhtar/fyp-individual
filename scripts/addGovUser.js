const pool = require('../config/database');
const bcrypt = require('bcrypt');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    const [key, ...rest] = arg.split('=');
    args[key.replace(/^--/, '')] = rest.join('=');
  });
  return args;
}

async function main() {
  const args = parseArgs();
  const email = args.email;
  const password = args.password;
  const department = args.department || args.department_name || '';
  const designation = args.designation || '';

  if (!email || !password) {
    console.error('Usage: node scripts/addGovUser.js --email=you@org.com --password=pass123 --department="Dept" --designation="Admin"');
    process.exit(1);
  }

  pool.query('SELECT * FROM registrations WHERE email = ?', [email], async (err, results) => {
    if (err) {
      console.error('DB error:', err);
      process.exit(1);
    }

    if (results.length > 0) {
      console.error('A user with that email already exists.');
      process.exit(1);
    }

    try {
      const hashed = await bcrypt.hash(password, 10);

      pool.query(
        'INSERT INTO registrations (email, password_hash, role, kyc_status) VALUES (?, ?, ?, ?)',
        [email, hashed, 'gov', false],
        (regErr, regRes) => {
          if (regErr) {
            console.error('Error inserting registration:', regErr);
            process.exit(1);
          }

          const registrationId = regRes.insertId;
          pool.query(
            'INSERT INTO government_admins (registration_id, department_name, designation) VALUES (?, ?, ?)',
            [registrationId, department, designation],
            (govErr) => {
              if (govErr) {
                console.error('Error inserting government_admins:', govErr);
                process.exit(1);
              }
              console.log('Government user created successfully. registration_id =', registrationId);
              pool.end(() => process.exit(0));
            }
          );
        }
      );
    } catch (e) {
      console.error('Unexpected error:', e);
      process.exit(1);
    }
  });
}

main();
