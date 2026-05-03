const { spawn } = require("child_process");
const path = require("path");

exports.detectAnomaly = (logs) => {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, "../ai/predict.py");

    // const process = spawn("python", [
    //   script,
    //   JSON.stringify(logs)
    // ]);

    const process = spawn("python3", [
  script,
  JSON.stringify(logs)
]);

    let output = "";
    let errorOutput = "";

    process.stdout.on("data", (data) => {
      output += data.toString();
    });

    process.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    process.on("close", () => {
      if (errorOutput) {
        console.error("PYTHON ERROR:", errorOutput);
        return reject(new Error(errorOutput));
      }

      try {
        console.log("PYTHON OUTPUT:", output);
        resolve(JSON.parse(output));
      } catch (err) {
        console.error("INVALID JSON:", output);
        reject(err);
      }
    });
  });
};