import http from "http";
import puppeteer from "puppeteer";

const PORT = process.env.PORT || 10000;
const THREE_HOURS_TWO_MINS_MS = (3 * 60 + 2) * 60 * 1000;

let isQuantRunning = false;
let lastQuantRunTime = Date.now();

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || token.includes("YOUR_")) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML"
      })
    });

    if (!res.ok) {
      const errData = await res.json();
      console.error("❌ [TELEGRAM API ERROR]:", errData);
    }
  } catch (err) {
    console.error("❌ [TELEGRAM ERROR]:", err.message);
  }
}

// Universal event dispatcher to bypass Uni-App touch/click layer issues
async function safeClick(page, elementHandle) {
  if (!elementHandle) return false;
  try {
    await elementHandle.evaluate((el) => {
      ["pointerdown", "touchstart", "mousedown", "pointerup", "touchend", "mouseup", "click"].forEach((evt) => {
        el.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
      });
    });
    return true;
  } catch (_) {
    return false;
  }
}

export async function runQuantificationTask() {
  let browser = null;

  const ZEN_PHONE = process.env.ZENQUANT_PHONE;
  const ZEN_PASSWORD = process.env.ZENQUANT_PASSWORD;
  const STEEL_API_KEY = process.env.STEEL_API_KEY;
  const BASE_URL = "https://zenquantai.com";

  if (!ZEN_PHONE || !ZEN_PASSWORD || !STEEL_API_KEY) {
    console.error("❌ [ZENQUANT ERROR] Missing ZENQUANT_PHONE, ZENQUANT_PASSWORD, or STEEL_API_KEY env variables.");
    return;
  }

  try {
    console.log("\n==================================================");
    console.log("🤖 [ZENQUANT] Connecting to Steel.dev remote browser...");
    console.log("==================================================");

    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://connect.steel.dev?apiKey=${STEEL_API_KEY}`
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // ----------------------------------------------------
    // STEP 1: LOGIN PROCEDURE
    // ----------------------------------------------------
    console.log("🔑 [ZENQUANT STEP 1] Navigating to Login Page...");
    await page.goto(`${BASE_URL}/#/pages/login/login`, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    console.log("⏳ [ZENQUANT] Waiting for Uni-App inputs to mount...");
    await page.waitForSelector("input.uni-input-input", { timeout: 30000 });
    await new Promise((res) => setTimeout(res, 2500));

    // Handle Country Prefix Selection
    console.log("🌍 [ZENQUANT] Checking country prefix list...");
    const selectedCountry = await page.evaluate(() => {
      const countryRows = Array.from(document.querySelectorAll(".country-list-row"));
      const nigeriaRow = countryRows.find((el) => el.innerText && (el.innerText.includes("Nigeria") || el.innerText.includes("+234")));
      if (nigeriaRow) {
        nigeriaRow.click();
        return true;
      }
      return false;
    });

    if (selectedCountry) {
      console.log("✅ [ZENQUANT] Selected Nigeria (+234) from country list.");
      await new Promise((res) => setTimeout(res, 800));
    }

    // Input Credentials
    console.log("🎯 [ZENQUANT] Locating native Phone & Password inputs...");
    const phoneInputHandle = await page.$('input.uni-input-input[type="number"]');
    const passInputHandle = await page.$('input.uni-input-input[type="password"]');

    if (phoneInputHandle && passInputHandle) {
      console.log(`✍️ [ZENQUANT] Typing phone (${ZEN_PHONE.slice(0, 4)}***)...`);
      await phoneInputHandle.click({ clickCount: 3 });
      await phoneInputHandle.type(ZEN_PHONE, { delay: 50 });
      await page.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, phoneInputHandle);

      await new Promise((res) => setTimeout(res, 500));

      console.log("🔐 [ZENQUANT] Typing password...");
      await passInputHandle.click({ clickCount: 3 });
      await passInputHandle.type(ZEN_PASSWORD, { delay: 50 });
      await page.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, passInputHandle);
    } else {
      throw new Error("Target login input elements missing from DOM.");
    }

    await new Promise((res) => setTimeout(res, 1000));

    // Submit Login CTA
    console.log("👆 [ZENQUANT] Locating Login CTA button (.zq-cta)...");
    const loginCtaHandle = await page.$('.zq-cta');

    if (loginCtaHandle) {
      console.log("🎯 [ZENQUANT] CTA button found! Dispatching event sequence...");
      await safeClick(page, loginCtaHandle);
      console.log("🚀 [ZENQUANT] Login submitted! Waiting 7 seconds for API auth response...");
    } else {
      const fallbackBtn = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll("uni-view, uni-button, button")).find(
          (el) => el.innerText && el.innerText.trim().toUpperCase() === "LOGIN"
        );
      });
      const el = await fallbackBtn.asElement();
      if (el) await safeClick(page, el);
    }

    await new Promise((res) => setTimeout(res, 7000));

    // Route Verification
    const currentUrl = page.url();
    console.log(`📌 [ZENQUANT POST-LOGIN CHECK] Current URL: ${currentUrl}`);

    if (currentUrl.includes("login")) {
      console.error("❌ [ZENQUANT LOGIN FAILED] Still on login route after submit attempt. Aborting run.");
      await sendTelegram("❌ <b>ZenQuant Bot Error:</b> Login failed. Credentials or submit tap rejected.");
      return;
    }

    console.log("✅ [ZENQUANT LOGIN SUCCESS] Auth complete! Navigated away from login page.");

    // ----------------------------------------------------
    // STEP 2: NAVIGATE TO TRADE PAGE
    // ----------------------------------------------------
    console.log("\n📈 [ZENQUANT STEP 2] Navigating to Trade page...");
    await page.goto(`${BASE_URL}/#/pages/UITransaction/trade`, {
      waitUntil: "domcontentloaded",
      timeout: 35000
    });

    console.log("⏳ [ZENQUANT] Waiting 5 seconds for trade page state hydration...");
    await new Promise((res) => setTimeout(res, 5000));

    // ----------------------------------------------------
    // STEP 3: CLAIM ALL SETTLEMENT CARDS (3Hours + Plus)
    // ----------------------------------------------------
    console.log("\n💰 [ZENQUANT STEP 3] Scanning for active position settlements...");
    let claimsProcessed = 0;

    while (true) {
      const claimed = await page.evaluate(() => {
        const allElements = Array.from(document.querySelectorAll('*'));
        
        // Find any leaf element with exact text "Claimable" or "Receive"
        const claimBtn = allElements.find((el) => {
          if (!el || el.offsetHeight === 0 || el.children.length > 0) return false;
          const txt = el.innerText ? el.innerText.trim().toUpperCase() : '';
          return txt === 'CLAIMABLE' || txt === 'RECEIVE' || el.classList.contains('uit-order-lists__receive-btn-text');
        });

        if (claimBtn) {
          ['pointerdown', 'touchstart', 'mousedown', 'pointerup', 'touchend', 'mouseup', 'click'].forEach((evt) => {
            claimBtn.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
          });
          return true;
        }
        return false;
      });

      if (!claimed) break;

      claimsProcessed++;
      console.log(`🎯 [ZENQUANT] Tapped 'Claimable' button #${claimsProcessed}...`);
      await new Promise((res) => setTimeout(res, 2000));

      // Handle Modal Confirmation (.btnConfirm)
      const confirmBtnHandle = await page.$('.btnConfirm');

      if (confirmBtnHandle) {
        console.log(`🎯 [ZENQUANT] Settlement modal confirm button found! Tapping...`);
        await safeClick(page, confirmBtnHandle);
        await new Promise((res) => setTimeout(res, 2500));
      } else {
        await page.evaluate(() => {
          const btn = document.querySelector('.btnConfirm') || 
                      Array.from(document.querySelectorAll("uni-view")).find(
                        (el) => el.classList.contains("btnConfirm") || (el.innerText && el.innerText.trim().toUpperCase() === "CONFIRM")
                      );
          if (btn) {
            ["pointerdown", "touchstart", "mousedown", "pointerup", "touchend", "mouseup", "click"].forEach((evt) => {
              btn.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
            });
          }
        });
        await new Promise((res) => setTimeout(res, 2500));
      }
    }

    if (claimsProcessed > 0) {
      console.log(`🎉 [ZENQUANT SUCCESS] Total positions claimed: ${claimsProcessed}`);
      await sendTelegram(`🤖 <b>ZenQuant Bot</b>\n✅ Claimed payouts from <b>${claimsProcessed}</b> open position(s)!`);
      console.log("⏳ [ZENQUANT] Waiting 5 seconds for balance refresh post-claim...");
      await new Promise((res) => setTimeout(res, 5000));
    } else {
      console.log("ℹ️ [ZENQUANT] No active positions marked 'Claimable'.");
    }

    // ----------------------------------------------------
    // STEP 4: VERIFY PRIMARY STRATEGY SELECTION ("Plus")
    // ----------------------------------------------------
    console.log("\n⏳ [ZENQUANT STEP 4] Verifying strategy selection ('Plus')...");
    const durationTabs = await page.$$('.trade-dur');
    let plusFound = false;

    for (const tab of durationTabs) {
      const text = await page.evaluate((el) => el.innerText.trim(), tab);
      if (text.toUpperCase() === "PLUS") {
        plusFound = true;
        const isActive = await page.evaluate((el) => {
          const bg = window.getComputedStyle(el).backgroundColor;
          return el.classList.contains('trade-dur--on') || 
                 el.classList.contains('active') || 
                 (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
        }, tab);

        if (!isActive) {
          console.log("🔄 [ZENQUANT] 'Plus' tab present but inactive. Tapping to select...");
          await safeClick(page, tab);
          await new Promise((res) => setTimeout(res, 1000));
        } else {
          console.log("✅ [ZENQUANT] 'Plus' strategy tab is already active by default.");
        }
        break;
      }
    }

    if (!plusFound) {
      console.log("ℹ️ [ZENQUANT] Retaining default strategy selection on trade page.");
    }

    // ----------------------------------------------------
    // STEP 5: TRADE STAGE 1 - PLUS (MAX $50)
    // ----------------------------------------------------
    console.log("\n💵 [ZENQUANT STEP 5] Reading Available Balance for Stage 1 (Plus)...");
    const rawBalance = await page.evaluate(() => {
      const balanceNode = document.querySelector('.trade-inject-balance__num');
      return balanceNode ? parseFloat(balanceNode.innerText.trim()) : 0;
    });

    let amountToInject = Math.floor(rawBalance);
    if (amountToInject > 50) amountToInject = 50;

    console.log(`📊 [ZENQUANT STAGE 1 REPORT] Detected Raw Balance: ${rawBalance} USD | Target Plus Reinvestment: ${amountToInject} USD`);

    if (amountToInject > 0) {
      console.log(`🚀 [ZENQUANT STAGE 1] Injecting ${amountToInject} USD into Plus...`);

      const numberInputHandle = await page.$('input.uni-input-input');

      if (numberInputHandle) {
        console.log("✍️ [ZENQUANT] Typing amount into injection input...");
        await numberInputHandle.click({ clickCount: 3 });
        await numberInputHandle.type(amountToInject.toString(), { delay: 100 });

        await page.evaluate((el) => {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, numberInputHandle);
      } else {
        console.error("⚠️ [ZENQUANT ERROR] Injection input field not found.");
      }

      await new Promise((res) => setTimeout(res, 1200));

      console.log("👆 [ZENQUANT] Triggering Confirm Injection button...");
      const confirmHandle = await page.$('uni-button.trade-submit');

      if (confirmHandle) {
        await safeClick(page, confirmHandle);
        console.log(`🎉 [ZENQUANT SUCCESS] Successfully injected ${amountToInject} USD into Plus!`);
        await sendTelegram(`🤖 <b>ZenQuant Bot</b>\n⚡ Successfully reinvested <b>${amountToInject} USD</b> into 3-Hour Plus session!`);

        console.log("⏳ [ZENQUANT] Holding connection for 30 seconds to settle network requests...");
        await new Promise((res) => setTimeout(res, 30000));
      } else {
        console.error("⚠️ [ZENQUANT ERROR] Confirm Injection button ('uni-button.trade-submit') not found in DOM.");
      }
    } else {
      console.log("⚠️ [ZENQUANT INSIGHT] Available balance is 0 USD. Skipping Stage 1.");
    }

    // ----------------------------------------------------
    // STEP 6: TRADE STAGE 2 - 3HOURS NORMAL (MIN $10)
    // ----------------------------------------------------
    console.log("\n💵 [ZENQUANT STEP 6] Switching strategy tab to '3Hours' for Stage 2...");
    
    const tabSwitched = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.trade-dur'));
      const threeHoursTab = tabs.find((el) => el.innerText && el.innerText.trim().toUpperCase().includes("3HOURS"));
      
      if (threeHoursTab) {
        const target = threeHoursTab.querySelector('span') || threeHoursTab;
        ["pointerdown", "touchstart", "mousedown", "pointerup", "touchend", "mouseup", "click"].forEach((evt) => {
          target.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
        });
        return true;
      }
      return false;
    });

    if (tabSwitched) {
      console.log("✅ [ZENQUANT] Tapped '3Hours' strategy tab. Waiting 3s for UI refresh...");
      await new Promise((res) => setTimeout(res, 3000));
    }

    const remainingBalance = await page.evaluate(() => {
      const balanceNode = document.querySelector('.trade-inject-balance__num');
      return balanceNode ? parseFloat(balanceNode.innerText.trim()) : 0;
    });

    const secondaryAmount = Math.floor(remainingBalance);
    console.log(`📊 [ZENQUANT STAGE 2 REPORT] Remaining Balance: ${remainingBalance} USD | Target 3Hours Trade: ${secondaryAmount} USD`);

    if (secondaryAmount >= 10) {
      console.log(`🚀 [ZENQUANT STAGE 2] Remaining balance >= $10. Proceeding with 3Hours reinvestment...`);

      const numberInputHandle = await page.$('input.uni-input-input');

      if (numberInputHandle) {
        console.log(`✍️ [ZENQUANT] Typing ${secondaryAmount} USD into 3Hours injection input...`);
        await numberInputHandle.click({ clickCount: 3 });
        await numberInputHandle.type(secondaryAmount.toString(), { delay: 100 });

        await page.evaluate((el) => {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, numberInputHandle);
      }

      await new Promise((res) => setTimeout(res, 1200));

      console.log("👆 [ZENQUANT] Triggering Confirm Injection button for 3Hours...");
      const confirmHandle = await page.$('uni-button.trade-submit');

      if (confirmHandle) {
        await safeClick(page, confirmHandle);
        console.log(`🎉 [ZENQUANT SUCCESS] Successfully injected ${secondaryAmount} USD into 3Hours session!`);
        await sendTelegram(`🤖 <b>ZenQuant Bot</b>\n⚡ Successfully reinvested <b>${secondaryAmount} USD</b> into 3-Hour Normal session!`);

        console.log("⏳ [ZENQUANT] Holding connection for 30 seconds to settle network requests...");
        await new Promise((res) => setTimeout(res, 30000));
      } else {
        console.error("⚠️ [ZENQUANT ERROR] Confirm Injection button ('uni-button.trade-submit') not found during 3Hours trade.");
      }
    } else {
      console.log(`ℹ️ [ZENQUANT INSIGHT] Remaining balance (${remainingBalance} USD) is under the $10 minimum threshold for 3Hours trade. Skipping Stage 2.`);
    }

  } catch (err) {
    console.error("\n❌ [ZENQUANT TASK CRITICAL ERROR]:", err.message);
    await sendTelegram(`❌ <b>ZenQuant Bot Error:</b> ${err.message}`);
  } finally {
    if (browser) {
      await browser.disconnect();
      console.log("🔒 [ZENQUANT] Disconnected cleanly from Steel.dev remote browser.\n");
    }
  }
}

// Execution Wrapper
async function executeTrigger(source = "SCHEDULED") {
  if (isQuantRunning) {
    console.log(`⚠️ Task already running (Trigger: ${source}). Skipping.`);
    return false;
  }
  isQuantRunning = true;
  lastQuantRunTime = Date.now();
  try {
    await runQuantificationTask();
  } catch (err) {
    console.error("❌ Execution error:", err.message);
  } finally {
    isQuantRunning = false;
  }
}

// Server & Cron Runner
http.createServer((req, res) => {
  const reqUrl = req.url || "/";

  if (reqUrl.startsWith("/run-quant")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "ZenQuant trigger received!" }));
    executeTrigger("HTTP_CRON_TRIGGER");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ZenQuant Multi-Task Server Active");

}).listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Self-ping to keep awake + 3-hour backup runner
setInterval(async () => {
  const APP_URL = process.env.RENDER_EXTERNAL_URL;
  if (APP_URL) {
    try {
      await fetch(APP_URL);
    } catch (_) {}
  }

  const elapsed = Date.now() - lastQuantRunTime;
  if (elapsed >= THREE_HOURS_TWO_MINS_MS) {
    executeTrigger("INTERVAL_CRON");
  }
}, 10 * 60 * 1000);

// Initial boot execution
executeTrigger("INITIAL_BOOT");
