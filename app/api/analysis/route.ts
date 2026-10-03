import { aiChat } from "@/lib/aiGateway";
import { getUserProfile, profileSystemMessage } from "@/lib/userAge";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit, consumeErrorMessage } from "@/lib/billing/entitlements";


export async function POST(request: NextRequest) {
    // OpenAI call — limit to 10/hour per IP
    const rateBlock = applyApiRateLimit(request, "analysis", 10, 60 * 60 * 1000);
    if (rateBlock) return rateBlock;

    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.userId;

    // This page isn't linked from anywhere in the nav, but was still POST-reachable (and
    // ungated) by any logged-in user who knew or guessed the URL — a real gap found in the
    // free-tier AI audit.
    const billingUser = await getUserById(userId).catch(() => null);
    if (!billingUser || !resolveEntitlement(billingUser).hasAI) {
      return NextResponse.json({ error: "This feature requires an upgrade.", locked: true }, { status: 402 });
    }
    const consumeResult = await consumeAiCredit(billingUser);
    if (!consumeResult.allowed) {
      return NextResponse.json({ error: consumeErrorMessage(consumeResult.reason), capReached: true }, { status: 429 });
    }

    const { data: garments, error } = await supabase
        .from("garments")
        .select("id, title, category, brand, price, sub_type, color_primary, color_secondary, material, aesthetic_tags")
        .eq("user_id", userId);
    
    if (error || !garments || garments.length == 0){
        return NextResponse.json({ error: "No garments found" }, { status: 404 });
    }

    const garmentList = garments
        .map((g, i) => `${i + 1}. ID: ${g.id} | Title: ${g.title} | Category: ${g.category} | Price: ${g.price}`)
        .join("\n");

    const prompt = `You are a professional fashion stylist and wardrobe consultant. Analyze this wardrobe and provide detailed, honest critique.

WARDROBE:
${garmentList}

Return a JSON object with this exact structure:
{
  "overallScore": <number 0-100>,
  "overallCritique": "<2-3 sentence honest fashion assessment>",
  "brandAnalysis": "<assessment of brand diversity or overrepresentation>",
  "colorAnalysis": "<assessment of color palette, gaps, and balance>",
  "coordinationAnalysis": "<how well pieces work together>",
  "styleConsistency": "<is there a coherent style identity or is it scattered>",
  "pieces": [
    {
      "id": "<garment id>",
      "brand": "<extracted brand or Unknown>",
      "color": "<primary color>",
      "itemType": "<specific type e.g. hoodie, straight-leg jeans, chelsea boots>",
      "strengths": ["<strength 1>", "<strength 2>"],
      "weaknesses": ["<weakness 1>", "<weakness 2>"],
      "coordinatesWith": ["<garment id that pairs well>"],
      "missingPartners": ["<piece type needed to complete this item>"]
    }
  ],
  "gaps": [
    {
      "priority": <1-5, 1 being most urgent>,
      "gap": "<what is missing>",
      "why": "<why this matters for the wardrobe>",
      "recommendation": "<specific piece type to buy with style and color guidance>"
    }
  ]
}

Be specific and brutally honest. Reference actual piece names when relevant.`;

     // The user's age + gender (Settings → GENDER & AGE) tailor the analysis — lib/userAge.ts.
     const userProfile = await getUserProfile(session.userId);
     const completion = await aiChat("openai:chat:analysis", {
        model: "gpt-4o-mini",
        messages: [...profileSystemMessage(userProfile), { role: "user", content: prompt }],
        response_format: { type: "json_object" },
    }, billingUser);

    const analysis = JSON.parse(completion.content || "{}");

    return NextResponse.json({ analysis, garments });
        
}