const { GoogleSpreadsheet } = require("google-spreadsheet");
const creds = require("./google_cred.json");
const axios = require("axios");
require("dotenv").config();
const puppeteer = require("puppeteer");

const main = async () => {
  try {
    console.log("START: READING FILE");
    const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    const defaultSheet =
      doc.sheetsByIndex[parseInt(process.env.SHEET_INDEX, 10)];
    await defaultSheet.loadCells();
    const lines = await defaultSheet.getRows();
    console.log("DONE READ FILE");

    // Start browser
    console.log(
      process.env.IS_HEADLESS === "true"
        ? "START: Open browser in headless mode!"
        : "START: Open browser please wait!"
    );
    const browser = await puppeteer.launch({
      headless: process.env.IS_HEADLESS === "true",
      executablePath: process.env.CHROME_PATH,
    });
    const FROM_USER = process.env.FROM_USER || 0;
    const context = await browser.createIncognitoBrowserContext();
    await context.overridePermissions(process.env.GAME_LINK, [
      "clipboard-read",
    ]);
    const page = await context.newPage();
    let totalUser = 0;
    const startTime = Date.now();
    let stopReadSheet = false;
    console.log("STARTING!!!")
    for (let line of lines) {
      if (stopReadSheet) break;
      if (line.rowIndex <= FROM_USER) continue;
      totalUser++;
      const userStartTime = Date.now();
      let didGetCode = false;
      for (let retry = 0; retry < 2; retry++)
      {
        if (retry > 0) {
          console.log('Retry',retry)
        }
        try {
          // Clear cookies
          const client = await page.target().createCDPSession();
          await client.send("Network.clearBrowserCookies");
          await client.send("Network.clearBrowserCache");
          await page.goto(process.env.GAME_LINK, {
            waitUntil: "networkidle2",
          });
  
          // Get cell info
          const resultCell = defaultSheet.getCell(line.rowIndex - 2, 3);
          if (!resultCell) {
            stopReadSheet = true;
            break;
          };
          if (resultCell.value && resultCell.value != '.') break;
          const code2F = defaultSheet.getCell(line.rowIndex - 2, 2).value;
          const username = defaultSheet.getCell(line.rowIndex - 2, 0).value;
          const password = defaultSheet.getCell(line.rowIndex - 2, 1).value;
  
          console.log("=> Email", username);
          // Login
          const value = await axios.get(`https://2fa.live/tok/${code2F}`);
          const [signInbutton] = await page.$x(
            "//button[contains(., 'Sign in')]"
          );
          if (signInbutton) {
            await signInbutton.click();
            await page.waitForNavigation({ waitUntil: "networkidle2" });
  
            // Sign in process
            console.log("Signing in...");
            await page.focus("#ap_email");
            await page.keyboard.type(username);
            await page.focus("#ap_password");
            await page.keyboard.type(password);
            await page.$eval("#signInSubmit", (form) => form.click());
            await page.waitForNavigation({ waitUntil: "networkidle2" });
            if (value.data) {
              await page.focus("#auth-mfa-otpcode");
              await page.keyboard.type(value.data.token);
              await page.$eval("#auth-signin-button", (form) => form.click());
              await page.waitForNavigation({ waitUntil: "networkidle2" });
              console.log("Sign in success!");
              
              // Activate Prime Gaming
              try {
                console.log("Try to activate");
                await page.waitForSelector(
                  'button[data-a-target="activate-prime-button"]',
                  {
                    timeout: 2000,
                  }
                );
                await page.click('button[data-a-target="activate-prime-button"]');
                console.log("Not activate prime! Activating!");
                await page.waitForNavigation({ waitUntil: "networkidle2" });
                console.log("Activated!");
              } catch (err) {
                console.log("Activated! Skip activating!");
              }
              // Check if gift was collected or not
              try {
                console.log("Try to get game content!");
                await page.waitForSelector(
                  'button[data-a-target="buy-box_call-to-action"]',
                  {
                    timeout: 2000,
                  }
                );
                const isDisabled = await page.$eval(
                  'button[data-a-target="buy-box_call-to-action"]',
                  (button) => {
                    return button.disabled;
                  }
                );
                if (isDisabled) {
                  throw new Error("Get content button is disable!");
                }
                await page.click(
                  'button[data-a-target="buy-box_call-to-action"]'
                );
                await page.waitForNavigation({ waitUntil: "networkidle2" });
                await page.waitForSelector(
                  'button[aria-label="Copy code to your clipboard"]',
                  {
                    timeout: 2000,
                  }
                );
                await page.click(
                  'button[aria-label="Copy code to your clipboard"]'
                );
  
                // Save to sheet
                const code = await page.evaluate(() =>
                  navigator.clipboard.readText()
                );
                resultCell.value = code;
                console.log("Your gift is collected! Here is the code", code);
                didGetCode = true;
                await defaultSheet.saveUpdatedCells();
              } catch (err) {
                try {
                  await page.waitForSelector(
                    'button[aria-label="Copy code to your clipboard"]',
                    {
                      timeout: 2000,
                    }
                  );
                  await page.click(
                    'button[aria-label="Copy code to your clipboard"]'
                  );
  
                  // Save to sheet
                  const code = await page.evaluate(() =>
                    navigator.clipboard.readText()
                  );
                  resultCell.value = code;
                  console.log("Your gift is collected! Here is the code", code);
                  didGetCode = true;
                  await defaultSheet.saveUpdatedCells();
                } catch (err) {
                  console.log("Can't get code! Something wrong!!!!");
                }
              }
            }
          }
          if (didGetCode) {
            console.log(
              `DONE! Time: ${Date.now() - userStartTime} ms; Avg: ${
                (Date.now() - startTime) / totalUser / 1000
              } s/user. Total user ${totalUser}`
            );
            break;
          }
        } catch (err) {
          console.log("Error when try to work on line", line.rowIndex);
          console.log("Err: ", err)
          continue;
        }
      }
    }

    // End with close browser!
    await browser.close();
  } catch (err) {
    console.log("ERR", err);
  }
};

main();
