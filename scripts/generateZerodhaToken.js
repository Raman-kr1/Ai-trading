/**
 * Zerodha Token Generator
 * ========================
 * A utility script to generate the daily ACCESS_TOKEN required for Zerodha Kite API.
 * 
 * Usage: node scripts/generateZerodhaToken.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function generateToken() {
  const apiKey = process.env.ZERODHA_API_KEY;
  const apiSecret = process.env.ZERODHA_API_SECRET;

  if (!apiKey || !apiSecret || apiKey === 'your_zerodha_api_key') {
    console.error('❌ Error: Please set ZERODHA_API_KEY and ZERODHA_API_SECRET in your .env file first.');
    process.exit(1);
  }

  // 1. Generate the Login URL
  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}`;
  
  console.log('\n' + '='.repeat(60));
  console.log('🌐 ZERODHA KITE LOGIN');
  console.log('='.repeat(60));
  console.log('\n1. Copy and paste this URL into your browser:');
  console.log(`\x1b[36m${loginUrl}\x1b[0m`);
  console.log('\n2. Log in with your Zerodha credentials.');
  console.log('3. After login, you will be redirected to your Redirect URL.');
  console.log('4. Copy the "request_token" from the URL bar (e.g., ?request_token=XXXXX)');
  console.log('='.repeat(60) + '\n');

  rl.question('👉 Paste the request_token here: ', async (requestToken) => {
    if (!requestToken) {
      console.error('❌ Error: No request_token provided.');
      process.exit(1);
    }

    try {
      console.log('\n🔄 Generating Access Token...');

      // Zerodha requires SHA256(api_key + request_token + api_secret)
      const checksum = crypto
        .createHash('sha256')
        .update(apiKey + requestToken + apiSecret)
        .digest('hex');

      const response = await axios.post('https://api.kite.trade/session/token', 
        new URLSearchParams({
          api_key: apiKey,
          request_token: requestToken,
          checksum: checksum
        }).toString(),
        {
          headers: {
            'X-Kite-Version': '3',
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const accessToken = response.data.data.access_token;
      const userName = response.data.data.user_name;

      console.log(`✅ Success! Authenticated as: ${userName}`);
      
      updateEnvFile(accessToken);

    } catch (error) {
      console.error('❌ Failed to generate token:', error.response?.data?.message || error.message);
    } finally {
      rl.close();
    }
  });
}

function updateEnvFile(newToken) {
  const envPath = path.join(__dirname, '../.env');
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Regex to find ZERODHA_ACCESS_TOKEN and replace its value
  const regex = /^ZERODHA_ACCESS_TOKEN=.*$/m;
  
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `ZERODHA_ACCESS_TOKEN=${newToken}`);
    fs.writeFileSync(envPath, envContent);
    console.log('💾 .env file has been updated with the new Access Token.');
    console.log('\n🚀 You are now ready to trade for the next 24 hours!');
  } else {
    console.error('❌ Error: ZERODHA_ACCESS_TOKEN key not found in .env file.');
  }
}

generateToken();
