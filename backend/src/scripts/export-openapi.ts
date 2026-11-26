import { writeFileSync } from "node:fs";
import { buildOpenApi } from "../http/openapi";

writeFileSync(process.argv[2] ?? "openapi.json", JSON.stringify(buildOpenApi(), null, 2));
process.stdout.write("openapi.json written\n");
