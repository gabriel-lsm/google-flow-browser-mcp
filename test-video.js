import { chromium } from 'playwright';
import { handleGenerateVideo } from './src/tools/generate-video.js';
import { setBrowser, setContext, setPage, setConnected } from './src/browser/connect.js';

async function main() {
    console.log("Connecting to the browser you opened...");
    try {
        const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
        const contexts = browser.contexts();
        const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
        const pages = context.pages();
        const page = pages.length > 0 ? pages[pages.length - 1] : await context.newPage();
        await page.bringToFront();
        
        setBrowser(browser);
        setContext(context);
        setPage(page);
        setConnected(true);

        console.log("Browser connected! Triggering video generation...");
        const result = await handleGenerateVideo({
            prompt: "Um gatinho fofo",
            model: "Veo 3.1 - Lite",
            ratio: "9:16",
            duration: "4s",
            quantity: 1
        });
        console.log("Success:", JSON.stringify(result, null, 2));
    } catch (err) {
        console.error("Error during generation:", err);
    } finally {
        console.log("Done. Check your browser!");
        process.exit(0);
    }
}
main();
