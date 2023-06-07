const Cnf = require("./config.json");
const creds = require("../google_cred.json");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("fs");
const execFile = require("child_process").execSync;
let count = 1;
const puppeteer = require("puppeteer-extra");
const pluginStealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(pluginStealth());

const TINSOFT_URL = "http://proxy.tinsoftsv.com/api/";
let proxyLocations = [];
let currentLocation = -1;
let browser;
let page;
let defaultSheet;

checkKey = async () => {
  if (!Cnf.use_proxy) {
    return;
  }
  console.log("Checking tinsoft key: START");
  const result = await axios.get(
    TINSOFT_URL + "getKeyInfo.php?key=" + Cnf.tinsoft_key
  );
  if (result.data.success != true) {
    throw new Error("Tinsoft key not found or expired. Please check again!");
  }
  console.log("Checking tinsoft key: DONE");
};

getLocationProxy = async () => {
  result = await axios.get(TINSOFT_URL + "getLocations.php");
  return result.data.data;
};

getCurrentIp = async () => {
  const result = await axios.get(
    TINSOFT_URL + "getProxy.php?key=" + Cnf.tinsoft_key
  );
  if (result.data.success != true) {
    throw new Error("Proxy not found. Please check again!");
  } else {
  }
  return result.data.proxy;
};

loadDoc = async () => {
  console.log("Loading data from google sheet: START");
  const doc = new GoogleSpreadsheet(Cnf.google_sheet_id);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  defaultSheet = doc.sheetsByIndex[parseInt(Cnf.google_sheet_index, 10)];
  await defaultSheet.loadCells();
  const lines = await defaultSheet.getRows();
  console.log("Loading data from google sheet: DONE");
  return lines;
};

initalBrowser = async () => {
  browser = await puppeteer.launch({
    headless: Cnf.is_headless,
    executablePath: Cnf.chrome_path,
  });
  const context = await browser.createIncognitoBrowserContext();
  //   await context.overridePermissions(process.env.GAME_LINK, ["clipboard-read"]);
  page = await context.newPage();
  const client = await page.target().createCDPSession();
  await client.send("Network.clearBrowserCookies");
  await client.send("Network.clearBrowserCache");
};
initial = async () => {
  console.log("Initial START");
  console.log("Config:");
  console.log(Cnf);
  try {
    const [data, , location, timeout] = await Promise.all([
      loadDoc(),
      checkKey(),
      getLocationProxy(),
      updateProxy(),
      //   initalBrowser(),
    ]);
    proxyLocations = location;
    console.log("Initial DONE");
    return [data, timeout];
  } catch (err) {
    console.log("Initial fail due to :" + err.toString());
  }
};
getRandomLocation = () => {
  let x = proxyLocations.filter((e) => parseInt(e.location) != currentLocation);
  return x.length > 0 ? x[Math.floor(Math.random() * x.length)].location : 0;
};

updateProxier = async (str) => {
  if (!Cnf.use_proxy) {
    return 0;
  }
  let txtList = str.split(":");
  const host = txtList[0];
  const port = txtList[1];
  let data = fs.readFileSync("riot_account/riot_proxy.xml", {
    encoding: "utf8",
  });
  data = data.replace("${{PROXY_HOST}}", host).replace("${{PROXY_PORT}}", port);
  fs.writeFileSync("riot_account/riot_proxy.ppx", data);
  console.log("Update Proxier START");
  try {
    try {
      fs.unlinkSync(Cnf.proxier_path + "\\riot_proxy.ppx");
    } catch (err) {
      console.log(err);
    }
    try {
      execFile(".\\riot_account\\riot_proxy.ppx", {
        timeout: 8000,
      });
    } catch (err) {
      console.log("Reach timeout");
    }
    console.log("Update Proxier DONE");
  } catch (err) {
    console.log(err);
  }
};

moveMouseRandomly = async () => {
  await page.mouse.move(Math.random() * 100, Math.random() * 100);
  await delay(500);
  await page.mouse.down();
  await page.mouse.move(Math.random() * 100, Math.random() * 100);
  await delay(500);
  await page.mouse.up();
};

updateProxy = async () => {
  for (let i = 0; i < 3; i++) {
    if (!Cnf.use_proxy) return 0;
    console.log("Updating Proxy START");
    const randomLocation = 0;
    const result = await axios.get(
      TINSOFT_URL +
        "changeProxy.php?key=" +
        Cnf.tinsoft_key +
        "&location=" +
        randomLocation
    );

    if (result.data.success) {
      console.log(
        "NEW proxy :",
        result.data.proxy,
        " in ",
        proxyLocations[randomLocation]?.name
      );
      const timeout = Date.now() + result.data.next_change * 1000;
      currentLocation = randomLocation;
      await updateProxier(result.data.proxy);
      await delay(5000);
      return timeout;
    } else {
      console.log("Error when update Proxy: " + result.data.description);
    }
    await delay(60 * 1000);
  }
  throw new Error("Error when update Proxy after 3 times. Exist script!");
};
function delay(time) {
  let x;
  if (time > 30 * 1000) {
    x = setInterval(() => {});
  }
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

getOTP = async (code2F) => {
  const value = await axios.get(`https://2fa.live/tok/${code2F}`);
  if (value.data) {
    return value.data.token;
  }
  return null;
};

execLine = async (line) => {
  console.log(
    "START CHECKING ACCOUNT",
    line._rawData[0],
    "Line",
    line.rowIndex
  );
  const resultCell = defaultSheet.getCell(line.rowIndex - 1, 3);
  if (resultCell.value) {
    console.log("Found result value => skip line", line.rowIndex);
    return;
  }
  let resultText = "";
  for (let i = 0; i < 2; i++) {
    if (browser) await browser.close();
    await initalBrowser();
    if (resultCell.value) break;
    try {
      await page.goto(Cnf.login_link, {
        waitUntil: "networkidle2",
      });
      console.log("Sign in....");
      await page.type("#ap_email", line._rawData[0]);
      await page.type("#ap_password", line._rawData[1]);
      await page.$eval("input[id=signInSubmit]", (el) => el.click());
      await page.waitForSelector("input[id=auth-mfa-otpcode]", {
        timeout: 5000,
      });
      let otp = await getOTP(line._rawData[2]);
      if (!otp) {
        resultCell.value = "Can't get OTP";
        break;
      }
      // OTP
      await page.type("#auth-mfa-otpcode", otp);
      await page.$eval("input[id=auth-signin-button]", (el) => el.click());
      try {
        await page.waitForSelector("a[id=ap-account-fixup-phone-skip-link]", {
          timeout: 5000,
        });
        await page.$eval("a[id=ap-account-fixup-phone-skip-link]", (el) =>
          el.click()
        );
      } catch (err) {}
      for (let j = 0; j < 3; j++) {
        try {
          await page.waitForSelector(`input[data-a-target="tw-input"]`, {
            timeout: 15000,
          });
          break;
        } catch (err) {}
        const url = await page.url();
        if (url == "https://www.amazon.com/") {
          console.log("Does not redirect to gaming => hold/wrong");
          resultCell.value = "Hold";
          throw new Error("Not login");
        }
        if (j == 2) {
          throw new Error("Not login");
        }
      }
      console.log("Sign in sucess!");

      let isTryFound = false;
      let isActiveFound = false;
      // try prime/active
      await Promise.all([
        new Promise(async (res, rej) => {
          try {
            console.log("Check Try Prime...");
            await page.waitForSelector(
              'button[data-a-target="try-prime-button"]',
              {
                timeout: 5000,
              }
            );
            console.log("Try Prime found!");
            isTryFound = true;
            await page.click('button[data-a-target="try-prime-button"]');
            await delay(2000);
            await page.waitForSelector(
              'button[data-a-target="confirm-country-button"]',
              {
                timeout: 5000,
              }
            );
            await page.click('button[data-a-target="confirm-country-button"]');
            await page.waitForSelector('input[value="Change"]', {
              timeout: 5000,
            });
            await page.$eval('input[value="Change"]', (el) => el.remove());
            await page.click('input[value="Change"]');
            // find first radio
            await page.waitForSelector('input[name="Continue"]', {
              timeout: 5000,
            });
            for (let n = 62; n < 122; n++) {
              console.log("Choosing card...", n, "not stuck");
              let idName = (
                await page.$$eval(`input[name="ppw-widgetState"]`, (el) =>
                  el.map((x) => x.getAttribute("data-pmts-component-id"))
                )
              )[0].split("-")[1];
              await moveMouseRandomly();

              try {
                await page.waitForSelector(`span[id="pp-${idName}-${n}"]`, {
                  timeout: 500,
                });
                await page.click(`span[id="pp-${idName}-${n}"]`);
                n = n + 9;
              } catch (err) {
                if (n == 121) {
                  resultCell.value = "Sign up error";
                  throw new Error("No more cards to pick");
                }
                clearLastLine();
                continue;
              }
              await page.click('input[name="Continue"]');
              await page.waitForSelector('input[value="Change"]', {
                timeout: 5000,
              });
              await delay(2000);
              await moveMouseRandomly();
              const [joinButton] = await page.$x(
                "//span[contains(text(), 'Join Amazon Prime')]"
              );
              if (joinButton) {
                await joinButton.click();
              } else {
                const [freeButton] = await page.$x(
                  "//span[contains(text(), 'Start your free trial')]"
                );

                if (freeButton) {
                  await freeButton.click();
                } else {
                  throw new Error("Not found any button");
                }
              }
              try {
                await delay(3000);
                const [signUpError] = await page.$x(
                  "//h4[contains(text(), 'Sign up problem')]"
                );
                if (signUpError) {
                  continue;
                }
              } catch (err) {
                break;
              }
            }
            try {
              await page.waitForSelector(`a[id="a-autoid-0-announce"]`, {
                timeout: 5000,
              });
              resultCell.value = "Sign up error";
              throw new Error("Sign up error");
            } catch (err) {}
            for (let t = Cnf.waiting_trial_time; t > 0; t--) {
              console.log(`Trying prime... waiting ${t}s`);
              await delay(1000);
              clearLastLine();
            }
            await page.goto(Cnf.gaming_link, {
              waitUntil: "networkidle2",
            });
            let checkPrime,
              checkActive = false;
            try {
              console.log("Check Activate Prime");
              await page.waitForSelector(
                'button[data-a-target="activate-prime-button"]',
                {
                  timeout: 5000,
                }
              );
              console.log("Activate Prime found!");
              checkActive = true;
              resultText = "acti";
              let now = 50;
              for (let re = 0; re < 10; re++) {
                await page.goto(Cnf.card_change_url, {
                  waitUntil: "networkidle2",
                });
                let idName = (
                  await page.$$eval(`input[name="ppw-widgetState"]`, (el) =>
                    el.map((x) => x.getAttribute("data-pmts-component-id"))
                  )
                )[0].split("-")[1];
                let foundInput = false;
                for (let i = now; i < 130; i++) {
                  try {
                    let el = await page.$eval(
                      `input[id=pp-${idName}-${i}]`,
                      (e) => {
                        return (
                          e.type.toLowerCase() === "radio" &&
                          e.title.toLowerCase() !=
                            "use your gift card balance when available"
                        );
                      }
                    );
                    if (el) {
                      await page.$eval(
                        `input[id=pp-${idName}-${i}]`,
                        (check) => (check.checked = true)
                      );
                      now = i + 10;
                      foundInput = true;
                      break;
                    }
                  } catch (err) {
                    continue;
                  }
                }
                if (!foundInput) {
                  console.log("No more card found");
                  break;
                }
                await page.click(
                  'input[name="ppw-widgetEvent:PreferencePaymentOptionSelectionEvent"]'
                );
                await delay(7000);
                await page.goto(Cnf.gaming_link, {
                  waitUntil: "networkidle2",
                });
                await page.click(
                  'button[data-a-target="activate-prime-button"]'
                );
                for (let t = Cnf.waiting_trial_time; t > 0; t--) {
                  console.log(`Activating prime... waiting ${t}s`);
                  await delay(1000);
                  clearLastLine();
                }
                await page.goto(Cnf.gaming_link, {
                  waitUntil: "networkidle2",
                });
                try {
                  await page.waitForSelector(
                    'button[data-a-target="activate-prime-button"]',
                    {
                      timeout: 5000,
                    }
                  );
                  console.log("Activate Prime found! retry with new card");
                } catch (err) {
                  console.log("No prime found => success");
                  resultText = "ok";
                  break;
                }
              }
            } catch (err) {}
            if (!checkActive)
              try {
                console.log("Check Try Prime");
                await page.waitForSelector(
                  'button[data-a-target="try-prime-button"]',
                  {
                    timeout: 5000,
                  }
                );
                console.log("Try Prime found!");
                checkPrime = true;
                resultText = "try";
              } catch (err) {}
            if (!(checkPrime || checkActive)) {
              resultText = "ok";
            }
          } catch (err) {
          } finally {
            res();
          }
        }),
        new Promise(async (res, rej) => {
          try {
            console.log("Check Activate Prime");
            await page.waitForSelector(
              'button[data-a-target="activate-prime-button"]',
              {
                timeout: 5000,
              }
            );
            console.log("Activate Prime found!");
            isActiveFound = true;
            resultText = "acti";
            let now = 50;
            for (let re = 0; re < 10; re++) {
              await page.goto(Cnf.card_change_url, {
                waitUntil: "networkidle2",
              });
              let idName = (
                await page.$$eval(`input[name="ppw-widgetState"]`, (el) =>
                  el.map((x) => x.getAttribute("data-pmts-component-id"))
                )
              )[0].split("-")[1];
              let foundInput = false;
              for (let i = now; i < 130; i++) {
                try {
                  let el = await page.$eval(
                    `input[id=pp-${idName}-${i}]`,
                    (e) => {
                      return (
                        e.type.toLowerCase() === "radio" &&
                        e.title.toLowerCase() !=
                          "use your gift card balance when available"
                      );
                    }
                  );
                  if (el) {
                    await page.$eval(
                      `input[id=pp-${idName}-${i}]`,
                      (check) => (check.checked = true)
                    );
                    now = i + 10;
                    foundInput = true;
                    break;
                  }
                } catch (err) {
                  continue;
                }
              }
              if (!foundInput) {
                console.log("No more card found");
                break;
              }
              await page.click(
                'input[name="ppw-widgetEvent:PreferencePaymentOptionSelectionEvent"]'
              );
              await delay(7000);
              await page.goto(Cnf.gaming_link, {
                waitUntil: "networkidle2",
              });
              await page.click('button[data-a-target="activate-prime-button"]');
              for (let t = Cnf.waiting_trial_time; t > 0; t--) {
                console.log(`Activating prime... waiting ${t}s`);
                await delay(1000);
                clearLastLine();
              }
              await page.goto(Cnf.gaming_link, {
                waitUntil: "networkidle2",
              });
              try {
                await page.waitForSelector(
                  'button[data-a-target="activate-prime-button"]',
                  {
                    timeout: 5000,
                  }
                );
                console.log("Activate Prime found! retry with new card");
              } catch (err) {
                console.log("No prime found => success");
                resultText = "ok";
                break;
              }
            }
          } catch (err) {
            console.log("Not found Activate Prime");
          } finally {
            res();
          }
        }),
      ]);
      if (!(isTryFound || isActiveFound)) {
        console.log("No button found => Prime is actived");
        resultText = "Prime";
      }
      resultCell.value = resultText;
      break;
    } catch (err) {
      const [wrongPassword] = await page.$x(
        "//span[contains(text(), 'Your password is incorrect')]"
      );
      if (wrongPassword) {
        resultCell.value = "Your password is incorrect";
        break;
      }
      const [noEmailFoundErr] = await page.$x(
        "//span[contains(text(), 'We cannot find an account with that email address')]"
      );
      if (noEmailFoundErr) {
        resultCell.value = "We cannot find an account with that email address";
        break;
      }
      const [otpWrong] = await page.$x(
        "//span[contains(text(), 'The One Time Password (OTP) you entered is not valid. Please try again.')]"
      );
      if (otpWrong) {
        resultCell.value = "OTP is invalid";
        break;
      }
      const [suspendAccount] = await page.$x(
        "//h4[contains(text(), 'Account on hold temporarily')]"
      );
      if (suspendAccount) {
        resultCell.value = "Account on hold temporarily";
        break;
      }
      const [importantMess] = await page.$x(
        "//h4[contains(text(), 'Important Message!')]"
      );
      if (importantMess) {
        resultCell.value = "Important Message!";
        break;
      }
      const url = await page.url();
      if (url == "https://www.amazon.com/") {
        console.log("Does not redirect to gaming => hold/wrong");
        resultCell.value = "Hold";
        break;
      }
      console.log(err);
    }
    count = count >= Cnf.no_account_per_proxy ? -1 : count + 1;
  }
  await defaultSheet.saveUpdatedCells();
  if (browser) await browser.close();
};

done = async () => {
  if (browser) {
    await browser.close();
  }
  console.log("SCRIPT EXIT!");
  process.exit();
};

const clearLastLine = () => {
  process.stdout.moveCursor(0, -1); // up one line
  process.stdout.clearLine(1); // from cursor to end
};

run = async () => {
  let [data, timeout] = await initial();
  if (data) {
    for (let line of data) {
      await execLine(line);
      if (Cnf.use_proxy) {
        console.log("Checking to change proxy");
        if (count == -1) {
          if (Date.now() < timeout) {
            console.log(
              "WAITING FOR UPDATE PROXY IN:",
              (timeout - Date.now()) / 1000,
              "s"
            );
            const x = setInterval(() => {
              clearLastLine();
              console.log(
                "WAITING FOR UPDATE PROXY IN:",
                (timeout - Date.now()) / 1000,
                "s"
              );
            }, 1000);
            await delay(timeout - Date.now());
            clearInterval(x);
          }
          timeout = await updateProxy();
          count = 0;
        }
      }
    }
  }
  done();
};

run();
