// Canonical sub-type lists for every garment slot.
// Names match scoring.ts → SUB_TYPE_SLOT exactly.
// "top" contains base + mid items; "outerwear" contains outer + vest items.

export const SUB_TYPES: Record<string, string[]> = {
  top: [
    // ── Base tops (worn directly against skin) ───────────────────────────────
    // Tees
    "T-Shirt", "Graphic Tee", "Long Sleeve Tee", "Pocket Tee", "Baseball Tee",
    "Oversized Tee", "Baby Tee", "Thermal Tee",
    // Tanks & sleeveless
    "Tank Top", "Tank", "Camisole", "Sleeveless Top", "Bra Top",
    "Tube Top", "Halter Top", "Bralette",
    // Crop & structured tops
    "Crop Top", "Bustier", "Corset Top", "Bodysuit", "Slip Top",
    "Knit Top", "Sequin Top", "Negligé Top",
    "Off-Shoulder Top", "Peplum Top", "Smock Top",
    "Sheer Top", "Mesh Top", "Lace Top",
    // Polo & henley
    "Polo", "Polo Shirt", "Rugby Shirt", "Henley", "Henley Shirt",
    // Button-up shirts
    "Oxford Shirt", "Dress Shirt", "Flannel Shirt", "Chambray Shirt",
    "Denim Shirt", "Linen Shirt", "Camp Collar Shirt", "Work Shirt",
    "Printed Shirt", "Silk Shirt", "Western Shirt", "Bowling Shirt",
    // Blouses & woven tops
    "Blouse", "Wrap Top", "One-Shoulder Top", "Asymmetric Top", "Tunic", "Peasant Top",
    // ── Mid-layer (pullovers / open-knit over base) ─────────────────────────
    "Pullover Hoodie", "Zip-Up Hoodie", "Crewneck Sweatshirt", "Zip-Up Sweatshirt",
    "Crewneck Sweater", "V-Neck Sweater", "Turtleneck", "Turtleneck Sweater",
    "Mock Neck Sweater", "Mock Neck", "Cable Knit Sweater", "Ribbed Sweater",
    "Chunky Knit Sweater", "Fair Isle Sweater", "Fisherman Sweater",
    "Shetland Sweater", "Knitwear", "Polo Sweater",
    "Quarter Zip", "Quarter-Zip", "Half Zip", "Half-Zip",
    "Cardigan", "Fleece Jacket", "Shrug", "Bolero",
  ],

  outerwear: [
    // ── Outer (jackets & coats) ─────────────────────────────────────────────
    // Light shells
    "Coach Jacket", "Windbreaker", "Harrington Jacket", "Cagoule", "Blouson",
    // Track & sport
    "Track Jacket", "MA-1", "Bomber Jacket", "Varsity Jacket",
    // Casual fabric
    "Denim Jacket", "Overshirt", "Shacket", "Chore Coat", "Barn Coat",
    "Workwear Jacket", "Waxed Jacket",
    // Leather & statement
    "Leather Jacket", "Moto Jacket", "Biker Jacket", "Sherpa Jacket",
    "Sherpa Coat", "Fleece Coat", "Cape", "Poncho", "Kimono Jacket",
    // Technical & outdoor
    "Field Jacket", "Mountain Jacket", "Shell Jacket", "Puffer Jacket",
    "Down Jacket", "Puffer Coat", "Quilted Jacket", "Rain Jacket",
    "Rain Coat", "Raincoat", "Mac", "Tech Jacket", "Soft Shell Jacket",
    "Hard Shell Jacket", "Ski Jacket", "Anorak", "Parka", "Wrap Jacket",
    // Tailored
    "Blazer", "Sport Coat", "Suit Jacket", "Double-Breasted Blazer",
    // Coats
    "Overcoat", "Trench Coat", "Wool Coat", "Wrap Coat", "Peacoat",
    "Car Coat", "Chesterfield Coat", "Longline Cardigan", "Duster",
    // ── Vest (sleeveless layers) ─────────────────────────────────────────────
    "Vest", "Sweater Vest", "Knit Vest", "Puffer Vest", "Down Vest",
    "Gilet", "Padded Vest", "Fleece Vest",
  ],

  onepiece: [
    // Dresses — mini
    "Mini Dress", "Bodycon Dress", "Slip Dress", "Cut-Out Dress", "Halter Dress",
    // Dresses — midi
    "Midi Dress", "Shirt Dress", "Shift Dress", "A-Line Dress", "Wrap Dress",
    "Denim Dress", "Blazer Dress",
    // Dresses — maxi
    "Maxi Dress", "Floral Dress", "Sundress",
    // Knitwear dresses
    "Sweater Dress", "Smock Dress", "T-Shirt Dress", "Knit Dress", "Ribbed Dress",
    // Jumpsuits & rompers
    "Jumpsuit", "Wide-Leg Jumpsuit", "Slim Jumpsuit", "Boilersuit",
    "Romper", "Playsuit", "Long Romper",
    // Overalls (require base underlayer)
    "Overalls", "Dungarees", "Denim Overalls", "Pinafore Dress", "Shortalls",
  ],

  bottom: [
    // Jeans
    "Jeans", "Straight Leg Jeans", "Slim Jeans", "Skinny Jeans",
    "Wide Leg Jeans", "Bootcut Jeans", "Flared Jeans", "Tapered Jeans",
    "Relaxed Jeans", "Baggy Jeans", "Cropped Jeans", "Bell Bottoms",
    "Denim Shorts", "Jorts",
    // Trousers & pants
    "Trousers", "Tailored Trousers", "Wide Leg Trousers", "Pleated Trousers",
    "Cropped Trousers", "Dress Pants", "Slacks", "Chinos", "Linen Pants",
    "Harem Pants", "Parachute Pants", "Corduroy Pants", "Velvet Trousers",
    "Culottes", "Palazzos", "Cargo Pants", "Leather Pants",
    // Athletic & knit
    "Sweatpants", "Joggers", "Track Pants", "Leggings", "Biker Shorts",
    "Running Shorts", "Track Shorts", "Lounge Shorts", "Compression Shorts",
    // Shorts
    "Shorts", "Cargo Shorts", "Chino Shorts", "Y2K Shorts",
    "Board Shorts", "Pleated Shorts",
    // Skirts
    "Mini Skirt", "Midi Skirt", "Maxi Skirt", "Knee Length Skirt",
    "Denim Skirt", "Pleated Skirt", "Wrap Skirt", "A-Line Skirt",
    "Pencil Skirt", "Satin Skirt", "Leather Skirt",
    "Cargo Skirt", "Tennis Skirt", "Tiered Skirt", "Asymmetric Skirt", "Kilt",
  ],

  footwear: [
    // Sneakers
    "Low-Top Sneakers", "High-Top Sneakers", "Mid-Top Sneakers",
    "Running Shoes", "Trail Runners", "Slip-On Sneakers", "Dad Sneakers",
    "Chunky Sneakers", "Platform Sneakers", "Basketball Sneakers",
    "Tennis Shoes", "Retro Sneakers", "Skate Shoes",
    // Boots
    "Chelsea Boots", "Combat Boots", "Work Boots", "Ankle Boots",
    "Platform Boots", "Knee-High Boots", "Cowboy Boots", "Hiking Boots",
    "Snow Boots", "Rain Boots", "Riding Boots", "Desert Boots",
    "Over-The-Knee Boots", "Thigh-High Boots",
    // Smart & dress
    "Loafers", "Dress Shoes", "Oxford Shoes", "Derby Shoes", "Monk Straps",
    "Ballet Flats", "Slingbacks", "Mary Janes", "Brogues", "Moccasins",
    "Espadrilles", "Clogs", "Heels", "Pumps", "Wedges", "Stilettos",
    "Block Heels", "Kitten Heels", "Platform Heels", "Approach Shoes",
    "Boat Shoes",
    // Open & sandals
    "Sandals", "Slides", "Mules", "Flip Flops",
    "Strappy Sandals", "Gladiator Sandals", "Platform Sandals",
    "Birkenstock", "Birkenstocks",
  ],

  accessory: [
    // Headwear (max 1)
    "Cap", "Snapback", "Trucker Hat", "Bucket Hat", "Beanie", "Beret",
    "Visor", "Fedora", "Flat Cap", "Cowboy Hat", "Balaclava",
    "Baseball Cap", "Dad Hat", "Fitted Cap", "Wide-Brim Hat",
    "Newsboy Cap", "Durag", "Headwrap",
    // Bags (max 1)
    "Backpack", "Tote Bag", "Shoulder Bag", "Mini Shoulder Bag",
    "Crossbody Bag", "Belt Bag", "Fanny Pack", "Top Handle Bag",
    "Clutch", "Wristlet", "Messenger Bag", "Satchel", "Hobo Bag",
    "Duffle Bag", "Mini Bag", "Micro Bag", "Pouch",
    "Market Bag", "Drawstring Bag", "Barrel Bag", "Baguette Bag", "Chest Rig",
    // Belts (max 1)
    "Belt", "Leather Belt", "Canvas Belt", "Chain Belt", "Suspenders",
    // Jewelry (stackable)
    "Necklace", "Chain Necklace", "Pendant Necklace", "Choker",
    "Watch", "Bracelet", "Bangle", "Cuff Bracelet",
    "Ring", "Earrings", "Hoop Earrings", "Stud Earrings",
    "Earcuff", "Brooch", "Pin", "Cufflinks",
    "Anklet", "Body Chain",
    // Eyewear (max 1)
    "Sunglasses", "Glasses",
    // Neck / face (max 1)
    "Scarf", "Silk Scarf", "Bandana", "Neck Scarf", "Neck Gaiter",
    // Ties (max 1)
    "Tie", "Necktie", "Bow Tie", "Silk Tie", "Bolo Tie", "Cravat",
    "Tie Bar", "Tie Clip", "Pocket Square",
    // Socks (max 1 pair)
    "Socks", "Ankle Socks", "Crew Socks", "Knee-High Socks", "Fishnet Socks",
    // Gloves (max 1 pair)
    "Gloves", "Fingerless Gloves", "Mittens",
    // Hair (max 1)
    "Hair Clip", "Hair Tie", "Headband", "Scrunchie", "Claw Clip",
    // Other
    "Wallet",
  ],
};
