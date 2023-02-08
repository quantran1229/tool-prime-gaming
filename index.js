const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./google_cred.json');
const axios = require('axios');
require('dotenv').config();
const puppeteer = require('puppeteer');

const main = async () => {
    try {
        const doc = new GoogleSpreadsheet('1bXazUyd1YinPTzrCeUNeWWrIFd-2_zw5XhT_zKZ2IVw');
        await doc.useServiceAccountAuth(creds);
        await doc.loadInfo();
        const defaultSheet = doc.sheetsByIndex[parseInt(process.env.SHEET_INDEX,10)];
        await defaultSheet.loadCells();
        const lines = await defaultSheet.getRows();
        
        // Start browser
        console.log("START: Open browser");
        const browser = await puppeteer.launch({
            headless: false,
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        });
        const page = await browser.newPage();
        await page.goto('https://gaming.amazon.com/genshin-impact-4/dp/amzn1.pg.item.08655560-ff3c-4922-86c3-26ea38480da1', {
            waitUntil: 'networkidle2',
        });
        const [signInbutton] = await page.$x("//button[contains(., 'Sign in')]");
        if (signInbutton) {
            await signInbutton.click();
            await page.waitForNavigation({waitUntil: 'networkidle2'});
            console.log("DONE")
        }
        console.log("START: READING FILE")
        // for (let line of lines) {
        //     const resultCell = defaultSheet.getCell(line.rowIndex-2,3);
        //     if (!resultCell) break;
        //     const code2F = defaultSheet.getCell(line.rowIndex-2,2).value;
        //     const username = defaultSheet.getCell(line.rowIndex-2,0).value;
        //     const password = defaultSheet.getCell(line.rowIndex-2,1).value;
        //     const value = await axios.get(`https://2fa.live/tok/${code2F}`);
        //     await page.click('sign-in-button');
        //     // if (value.data) {
        //     //     resultCell.value = value.data.token;
        //     //     await defaultSheet.saveUpdatedCells();
        //     // }
        // }
        // await defaultSheet.saveUpdatedCells();
        // await browser.close();
    } catch (err) {
        console.log("ERR",err)
    }
}

main()