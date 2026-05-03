const axios = require("axios");

// Replace with your OpenRouter API key
const OPENROUTER_API_KEY = "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";

exports.generateExplanation = async (co2, limit, riskScore) => {
  try {

    console.log("1")

    const prompt = `
An industrial carbon emission anomaly was detected.

CO2 emission value: ${co2}
Allowed emission limit: ${limit}
Anomaly risk score: ${riskScore}

Explain in simple terms why this reading might be abnormal and what the industry should inspect.
Keep the explanation within 3 sentences.
`;

    console.log("2")
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("response",response)

    return response.data.choices[0].message.content;

  } catch (err) {
    console.error("GenAI Error:", err.message);
    return "An unusual emission pattern was detected. Please inspect sensors or operational equipment.";
  }
};