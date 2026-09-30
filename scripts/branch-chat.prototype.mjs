// THROWAWAY: three branch-chat layouts on the existing Map, selected by ?variant=A|B|C.
// Run: node .\scripts\branch-chat.prototype.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { renderHtml } from "../com.github.copilot/extensions/chat-fork-map/renderer.mjs";

if (process.env.NODE_ENV === "production") {
    throw new Error("This prototype is not a production entry point.");
}

const original = renderHtml();
const end = original.indexOf('    refreshButton.addEventListener("click"');
async function prototypePage() {
    const [client, css] = await Promise.all([
        readFile(new URL("./branch-chat.prototype.js", import.meta.url), "utf8"),
        readFile(new URL("./branch-chat.prototype.css", import.meta.url), "utf8"),
    ]);
    const html = original.slice(0, end) + client + "</script></body></html>";
    const page = html.replace("</head>", "<style>" + css + "</style></head>");
    new vm.Script(page.match(/<script>([\s\S]*)<\/script>/)[1]);
    return page;
}
await prototypePage();

const server = createServer(async (request, response) => {
    if (request.method !== "GET" || new URL(request.url, "http://localhost").pathname !== "/") {
        response.writeHead(404);
        response.end("Prototype only: no API or real mutations.");
        return;
    }
    try {
        const page = await prototypePage();
        response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'",
        });
        response.end(page);
    } catch (error) {
        console.error(error);
        response.writeHead(500);
        response.end("Prototype render failed. See server output.");
    }
});
server.listen(Number(process.env.PORT) || 0, "127.0.0.1", () => {
    console.log("THROWAWAY / MOCK ONLY / in-memory drafts");
    console.log("http://127.0.0.1:" + server.address().port + "/?variant=A");
});
