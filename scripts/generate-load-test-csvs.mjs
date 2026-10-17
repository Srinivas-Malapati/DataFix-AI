import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(root, "public/samples");
const sizes = [1_000, 10_000, 50_000];
const customers = ["Ada Lovelace", "Grace Hopper", "Katherine Johnson", "Alan Turing", "Margaret Hamilton", "Barbara Liskov"];
const products = ["Starter", "Pro Plan", "Enterprise", "Analytics Add-on"];
const statuses = ["PAID", "PENDING", "REFUNDED", "FAILED"];
const regions = ["North America", "Europe", "Asia Pacific", "Latin America"];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function baseRow(index) {
  const customer = customers[index % customers.length];
  const product = products[index % products.length];
  const amount = ((index % 400) + 1) * 3.25;
  return [
    `ORD-${String(index + 1).padStart(7, "0")}`,
    index % 23 === 0 ? ` ${customer} ` : index % 11 === 0 ? customer.toLowerCase() : customer,
    index % 29 === 0 ? ` ${product} ` : index % 13 === 0 ? product.toUpperCase() : product,
    index % 17 === 0 ? `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : amount.toFixed(2),
    index % 37 === 0 ? "" : index % 19 === 0 ? statuses[index % statuses.length].toLowerCase() : statuses[index % statuses.length],
    index % 41 === 0 ? `${String((index % 12) + 1).padStart(2, "0")}/${String((index % 27) + 1).padStart(2, "0")}/2026` : `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
    index % 97 === 0 ? "" : `${customer.toLowerCase().replaceAll(" ", ".")}+${index}@example.com`,
    index % 31 === 0 ? regions[index % regions.length].toLowerCase() : regions[index % regions.length],
  ];
}

await mkdir(outputDir, { recursive: true });
for (const size of sizes) {
  const rows = [];
  let previous = null;
  for (let index = 0; index < size; index += 1) {
    const row = index > 0 && index % 50 === 0 ? [...previous] : baseRow(index);
    rows.push(row);
    previous = row;
  }
  const header = ["order_id", "customer", "product", "amount", "status", "order_date", "email", "region"];
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  await writeFile(resolve(outputDir, `sales_load_test_${size}.csv`), csv, "utf8");
}
