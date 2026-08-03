import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UUID = "dd03be59-8301-4f91-9bda-533f26650212";

// The 17 deleted garments (from our earlier query output)
const deleted = [
  { brand: "Jnco",              title: "JNCO Los Angeles Rhino Wide Leg",          category: "bottom"    },
  { brand: "Carhartt WIP",      title: "Carhartt WIP Men Craft Shirt",              category: "top"       },
  { brand: "Polo Ralph Lauren", title: "Polo Ralph Lauren Men's Shirts",            category: "top"       },
  { brand: "Baggy Clothing",    title: "Selvedge Denim",                            category: "bottom"    },
  { brand: "Off-White x Jordan",title: "Off White x Air Jordan 4 'Sail",           category: "footwear"  },
  { brand: "Wrangler",          title: "Wrangler Men's Shirts",                     category: "top"       },
  { brand: "Baggy Clothing",    title: "Black Selvedge Denim",                      category: "bottom"    },
  { brand: "Baggy Clothing",    title: "Green Selvedge Denim",                      category: "bottom"    },
  { brand: "Polo Ralph Lauren", title: "Polo Ralph Lauren Harrington Jacket",       category: "outerwear" },
  { brand: "Polo Ralph Lauren", title: "Polo Ralph Lauren Classic Harrington Jacket",category:"outerwear" },
  { brand: "Stussy",            title: "Stussy DSM Los Angeles Hood",               category: "top"       },
  { brand: "Polo Ralph Lauren", title: "Polo Ralph Lauren Polo Striped Shirt",      category: "top"       },
  { brand: "Cotton On",         title: "Cotton On Men's Super Baggy Trousers",      category: "bottom"    },
  { brand: "Tiffany & Co.",     title: "Tiffany 1837 Silver Ring",                  category: "accessory" },
  { brand: "Timberland",        title: "Timberland 6-inch Premium Boot",            category: "footwear"  },
  { brand: "Stussy",            title: "Stussy Sport Script Tee - Black",           category: "top"       },
  { brand: "BIRKENSTOCK",       title: "BIRKENSTOCK Boston Soft Footbed",           category: "footwear"  },
];

console.log("Searching streetwear_products for each deleted garment...\n");

const results: { item: typeof deleted[0]; product: Record<string, unknown> | null }[] = [];

for (const item of deleted) {
  // Try exact brand + title prefix match
  const { data } = await sb.from("streetwear_products")
    .select("id, brand, title, sub_type, color_primary, color_secondary, pattern, formality, material, aesthetic_tags, pros, cons, color_pairings, color_clashes, image_url, analyzed")
    .eq("brand", item.brand)
    .ilike("title", `%${item.title.slice(0, 20)}%`)
    .limit(1);
  
  const product = data?.[0] ?? null;
  results.push({ item, product });
  
  if (product) {
    console.log(`✔ FOUND  ${item.brand} — ${item.title.slice(0, 40)}`);
    console.log(`       → sub_type: ${product.sub_type}  color: ${product.color_primary}  analyzed: ${product.analyzed}`);
  } else {
    console.log(`✘ NOT FOUND  ${item.brand} — ${item.title.slice(0, 40)}`);
  }
}

const found = results.filter(r => r.product);
const notFound = results.filter(r => !r.product);
console.log(`\nFound: ${found.length}  Not found: ${notFound.length}`);
console.log("\nNot found items (need manual re-add):");
for (const r of notFound) console.log(` - ${r.brand} — ${r.item.title}`);
