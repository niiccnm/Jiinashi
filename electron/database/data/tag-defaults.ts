import Database from "better-sqlite3";

// --- INITIAL DATA & SEEDING ------------------------------------------------

export function initDefaultTags(
  db: Database.Database,
  options: { importTags: boolean; syncDefaults?: boolean },
) {
  if (!options.importTags) return;

  // 2. Tags
  const defaults: [string, string][] = [
    // Character Count
    ...[
      "1girl",
      "2girls",
      "3girls",
      "4girls",
      "5girls",
      "multiple girls",
      "1boy",
      "2boys",
      "3boys",
      "4boys",
      "5boys",
      "multiple boys",
      "solo",
      "solo focus",
      "male focus",
    ].map((t) => [t, "Character Count"] as [string, string]),

    // Copyright
    ...["Original", "virtual youtuber"].map(
      (t) => [t, "Copyright"] as [string, string],
    ),

    // Body Parts
    ...[
      "penis",
      "testicles",
      "small penis",
      "large penis",
      "huge penis",
      "pussy",
      "clitoris",
      "anus",
      "nipples",
      "areola",
      "areola slip",
      "ass",
      "navel",
      "belly",
      "feet",
      "thighs",
      "armpits",
      "barefoot",
      "bare shoulders",
      "tongue",
      "pubic hair",
      "female pubic hair",
      "armpit hair",
      "excessive pubic hair",
      "anus hair",
      "female anus hair",
      "crotch focus",
    ].map((t) => [t, "Body Parts"] as [string, string]),

    // Appearance
    ...[
      "breasts",
      "small breasts",
      "medium breasts",
      "large breasts",
      "huge breasts",
      "flat chest",
      "perky breasts",
      "sagging breasts",
      "pointy breasts",
      "trap",
      "futanari",
      "old woman",
      "old man",
      "child",
      "oppai loli",
      "petite",
      "bulge",
      "faceless",
      "cow ears",
      "wings",
      "halo",
      "horns",
      "asymmetrical bangs",
      "swept bangs",
      "two side up",
      "hair bun",
      "single bun",
      "double bun",
      "one side up",
      "side ponytail",
      "short twintails",
      "braid",
      "twin braids",
      "single braid",
      "long braid",
      "short braid",
      "low ponytail",
      "short ponytail",
      "low twintails",
      "low twin braids",
      "blush",
      "dark-skinned female",
      "dark skin",
      "gyaru",
      "tan",
      "tanlines",
      "short hair",
      "very short hair",
      "medium hair",
      "long hair",
      "very long hair",
      "black hair",
      "blonde hair",
      "blue hair",
      "brown hair",
      "grey hair",
      "red hair",
      "white hair",
      "orange hair",
      "sidelocks",
      "hair between eyes",
      "ahoge",
      "ponytail",
      "twintails",
      "parted bangs",
      "blunt bangs",
      "hair over one eye",
      "red eyes",
      "blue eyes",
      "yellow eyes",
      "green eyes",
      "black eyes",
      "brown eyes",
      "heart in eye",
      "animal ears",
      "cat ears",
      "pointy ears",
      "tail",
      "large areolae",
      "puffy nipples",
      "mole",
      "mole above eye",
      "mole above mouth",
      "mole beside mouth",
      "mole on cheek",
      "mole on ear",
      "mole on forehead",
      "mole on nose",
      "mole under eye",
      "mole under each eye",
      "mole under mouth",
      "mole on breast",
      "mole on areola",
      "mole on shoulder",
      "mole under breast",
      "mole on arm",
      "mole on armpit",
      "mole on crotch",
      "mole on hip",
      "wide hips",
      "mole on penis",
      "mole on pussy",
      "mole on stomach",
      "mole on testicles",
      "mole on ass",
      "mole on foot",
      "mole on leg",
      "mole on thigh",
      "freckles",
      "thick thighs",
      "muscular female",
      "muscular male",
      "bald",
      "fat",
      "fat man",
      "curvy",
      "plump",
      "skinny",
      "flat ass",
      "huge ass",
      "gigantic ass",
      "gigantic penis",
      "gigantic breasts",
      "large testicles",
      "huge testicles",
      "gigantic testicles",
      "small testicles",
      "dark areolae",
      "pregnant",
      "pregnant loli",
      "dark nipples",
      "dark anus",
      "fat mons",
      "hairy",
      "ugly bastard",
      "demon girl",
      "teacher",
      "tutor",
      "bunny girl",
      "tattoo",
      "pubic tattoo",
      "pixie cut",
    ].map((t) => [t, "Appearance"] as [string, string]),

    // Build
    ...[
      "loli",
      "tall female",
      "mature female",
      "shota",
      "muscular",
      "mesugaki",
      "mature male",
    ].map((t) => [t, "Build"] as [string, string]),

    // Gender
    ...["female", "male"].map((t) => [t, "Gender"] as [string, string]),

    // Meta
    ...["decensored", "animated"].map((t) => [t, "Meta"] as [string, string]),

    // Language
    ...["English", "Japanese", "Korean", "Chinese", "Spanish"].map(
      (t) => [t, "Language"] as [string, string],
    ),

    // Accessories
    ...[
      "collar",
      "choker",
      "mouth mask",
      "gloves",
      "elbow gloves",
      "cow ear hairband",
      "thigh strap",
      "glasses",
      "sunglasses",
      "piercing",
      "earrings",
      "ear piercing",
      "navel piercing",
      "nipple piercing",
    ].map((t) => [t, "Accessories"] as [string, string]),

    // Objects
    ...[
      "animal collar",
      "dog collar",
      "neck bell",
      "bell",
      "leash",
      "dildo",
      "anal beads",
      "butt plug",
      "anal tail",
      "anal ball wear",
      "sex toy",
      "vibrator",
      "cock ring",
      "rabbit vibrator",
      "hitachi magic wand",
      "remote control vibrator",
      "egg vibrator",
      "clitoral suction vibrator",
      "lotion bottle",
      "condom",
      "condom wrapper",
      "broken condom",
      "nose hook",
      "randoseru",
    ].map((t) => [t, "Objects"] as [string, string]),

    // Clothing
    ...[
      "swimsuit",
      "bikini",
      "underwear",
      "panties",
      "bra",
      "shirt",
      "pants",
      "socks",
      "pantyhose",
      "thighhighs",
      "blouse",
      "camisole",
      "shoes",
      "sleeveless",
      "spaghetti strap",
      "boots",
      "shorts",
      "thong",
      "t-back",
      "g-string",
      "c-string",
      "lingerie",
      "see-through clothes",
      "crossdressing",
      "school uniform",
      "school swimsuit",
      "one-piece swimsuit",
      "skirt",
      "dress",
      "cow print",
      "cow print bikini",
      "cow print thighhighs",
      "cow print gloves",
      "high heels",
      "animal print",
      "leopard print",
      "impossible clothes",
      "leotard",
    ].map((t) => [t, "Clothing"] as [string, string]),

    // Other
    ...[
      "cum",
      "cumdrip",
      "precum",
      "x-ray",
      "internal cumshot",
      "cheating",
      "NTR",
      "yuri",
      "yaoi",
      "drunk",
      "midriff",
      "midriff peek",
      "zettai ryouiki",
      "pussy juice",
      "anal fluid",
      "pussy juice trail",
      "age difference",
      "onee-shota",
      "height difference",
      "censored",
      "bar censor",
      "blur censor",
      "heart censor",
      "light censor",
      "mosaic censoring",
      "censored by text",
      "blank censor",
      "censored identity",
      "cameltoe",
      "sweat",
      "saliva",
      "cleavage",
      "nude",
      "steam",
      "steaming body",
      "^^^",
      "topless female",
      "no bra",
      "bottomless",
      "fake animal ears",
      "lotion",
      "lube",
      "skindentation",
      "trefoil",
      "wedgie",
      "deep skin",
      "drugs",
      "drugged",
      "pill",
      "reverse NTR",
      "uncle",
      "aunt",
      "niece",
      "cousin",
      "brother",
      "sister",
      "mother",
      "father",
      "full color",
      "multi-work series",
      "shibari",
    ].map((t) => [t, "Other"] as [string, string]),

    // Expressions
    ...[
      "happy",
      "sad",
      "ahegao",
      "bohegao",
      "ohhoai",
      "ohogao",
      "torogao",
      "tongue out",
      "fucked silly",
      ":>=",
      "embarrassed",
      "crying",
      "tears",
      "averting eyes",
      "expressionless",
      "half-closed eyes",
      "narrowed eyes",
      "jitome",
      "squinting",
      "closed eyes",
      "open mouth",
      "oral invitation",
      "fellatio gesture",
      "penetration gesture",
      "smug",
      "c:",
      "smirk",
      ":3",
      "aroused",
      "in heat",
      "naughty face",
      "seductive smile",
      "smile",
      "you gonna get raped",
      "licking lips",
      ":p",
      ":q",
      "tehepero",
      "one eye closed",
      "crazy smile",
      "evil smile",
      "false smile",
      "nervous smile",
      "disgust",
      "angry",
      "annoyed",
      "horrified",
      "scared",
      "rolling eyes",
      "cross-eyed",
      "heart-shaped pupils",
    ].map((t) => [t, "Expressions"] as [string, string]),

    // Actions
    ...[
      "v",
      "double v",
      "kiss",
      "hug",
      "french kiss",
      "leg lock",
      "standing",
      "sitting",
      "standing on one leg",
      "leg up",
      "legs up",
      "arm up",
      "arms up",
      "middle finger",
      "covering face",
      "covering own eyes",
      "covering own mouth",
      "covering privates",
      "facepalm",
      "covering one eye",
      "holding leash",
      "peeing",
      "vomit",
      "burp",
      "fart",
      "covering breasts",
      "covering nipples",
      "covering crotch",
      "covering ass",
      "heavy breathing",
      "mouth pull",
      "squatting",
      "mask lift",
      "kneeling",
      "spread legs",
      "m legs",
      "v legs",
      "wide spread legs",
      "lying",
      "on back",
      "on stomach",
      "on side",
      "grabbing own ass",
      "licking",
      "licking object",
      "waving",
      "trembling",
      "shaking",
      "twitching",
      "screaming",
      "shouting",
      "arguing",
      "fighting",
      "looking at viewer",
      "breath",
      "manspreading",
      "finger sucking",
      "licking finger",
      "licking foot",
      "toe sucking",
      "lubrication",
      "blackmail",
      "hypnosis",
      "corruption",
      "mind control",
      "all fours",
      "recording",
      "breast expansion",
      "voyeurism",
      "bent over",
      "leaning forward",
      "folded",
      "choke hold",
      "asphyxiation",
      "strangling",
      "choking on object",
      "straddling",
      "upright straddle",
      "sitting on lap",
      "lap pillow",
    ].map((t) => [t, "Actions"] as [string, string]),

    // Sex Acts
    ...[
      "vaginal",
      "anal",
      "oral",
      "fellatio",
      "paizuri",
      "cooperative paizuri",
      "double paizuri",
      "handsfree paizuri",
      "paizuri over clothes",
      "paizuri under clothes",
      "straddling paizuri",
      "handjob",
      "footjob",
      "fingering",
      "masturbation",
      "deepthroat",
      "sex",
      "armpit sex",
      "rape",
      "incest",
      "doggystyle",
      "sex from behind",
      "cowgirl position",
      "reverse cowgirl position",
      "boy on top",
      "girl on top",
      "prone bone",
      "clothed sex",
      "group sex",
      "rough sex",
      "standing sex",
      "spooning",
      "double penetration",
      "spitroast",
      "amazon position",
      "piledriver (sex)",
      "mounting",
      "female masturbation",
      "anal fingering",
      "fisting",
      "clothed masturbation",
      "male masturbation",
      "mutual masturbation",
      "crotch rub",
      "bukkake",
      "orgasm",
      "female orgasm",
      "mutual orgasm",
      "afterglow",
      "missionary",
      "standing missionary",
      "full nelson",
      "mating press",
      "suspension",
      "frottage",
      "kneepit sex",
      "naizuri",
      "glansjob",
      "cloth glansjob",
      "just the tip",
      "groping",
      "grabbing another's ass",
      "grabbing another's breast",
      "crotch grab",
      "grabbing own breast",
      "hairjob",
      "caressing testicles",
      "double handjob",
      "cooperative handjob",
      "nursing handjob",
      "cuddling handjob",
      "reverse nursing handjob",
      "reach-around",
      "two-handed handjob",
      "implied masturbation",
      "anilingus",
      "rusty trombone",
      "breast sucking",
      "breastfeeding",
      "cunnilingus",
      "autocunnilingus",
      "implied cunnilingus",
      "autofellatio",
      "cum swap",
      "implied fellatio",
      "cooperative fellatio",
      "multiple penis fellatio",
      "irrumatio",
      "hug and suck",
      "licking testicle",
      "sitting on face",
      "testicle sucking",
      "oral sandwich",
      "daisy chain (sex)",
      "gangbang",
      "triple penetration",
      "cooperative footjob",
      "love train",
      "cooperative breast smother",
      "orgy",
      "reverse spitroast",
      "threesome",
      "mmf threesome",
      "ffm threesome",
      "mmm threesome",
      "fff threesome",
      "cervical penetration",
      "covered penetration",
      "deep penetration",
      "inflation",
      "cum inflation",
      "enema",
      "large insertion",
      "stomach bulge",
      "male penetrated",
      "multiple insertions",
      "nipple penetration",
      "nipple stimulation",
      "nipple tweak",
      "nipple pull",
      "nipple rub",
      "biting nipple",
      "nipple flick",
      "nipple press",
      "nipple push",
      "nipple fingering",
      "licking nipple",
      "nosejob",
      "object insertion",
      "vaginal object insertion",
      "anal object insertion",
      "urethral insertion",
      "sounding",
      "prostate milking",
      "fingering through panties",
      "fingering through clothes",
      "implied fingering",
      "after sex",
      "puckered anus",
      "spread anus",
      "gaping",
      "spread pussy",
      "cum in pussy",
      "extreme gaping",
      "cum in ass",
      "invisible penis",
      "half-spread pussy",
      "spreading own pussy",
      "spreading another's pussy",
      "spreading own anus",
      "spreading another's anus",
      "toddlercon",
      "pet play",
      "cum overflow",
      "ejaculation",
      "female ejaculation",
      "scat",
      "erection",
      "tonguejob",
      "cooperative tonguejob",
      "fellatio under mask",
      "covered fellatio",
      "cum on body",
      "cum on breasts",
      "cum on ass",
      "emotionless sex",
      "cum in mouth",
      "after fellatio",
      "facial",
      "gokkun",
      "cum on tongue",
      "table humping",
      "mind break",
      "prostitution",
      "penis on face",
      "penis over eyes",
      "penis over one eye",
      "penis shadow",
      "facejob",
      "penis awe",
      "penis on stomach",
      "condom on penis",
      "holding condom",
      "used condom",
      "drinking from condom",
      "condom left inside",
      "condom on nipples",
      "pointless condom",
      "used condom on mouth",
      "condom belt",
      "condom thigh strap",
      "lactation",
      "impregnation",
      "stealth sex",
      "suspended congress",
      "reverse suspended congress",
      "full nelson",
      "locked legs",
      "reverse upright straddle",
      "implied sex",
      "69",
      "grinding",
      "buttjob",
      "cooperative grinding",
      "backjob",
      "thigh sex",
    ].map((t) => [t, "Sex Acts"] as [string, string]),
  ];

  // Default tag metadata: keywords and descriptions
  const defaultTagMeta: Record<
    string,
    { keywords?: string[]; description?: string }
  > = {
    // Character Count

    // Copyright
    "virtual youtuber": {
      keywords: ["Vtuber"],
      description:
        "A virtual YouTuber, or VTuber, is a content creator or personality who uses a 2D or 3D digital avatar for online videos and/or livestreaming, often assuming a character as well. Despite the name, VTubers are not limited to the YouTube platform.",
    },

    // Body Parts
    penis: {
      keywords: [
        "chinchin",
        "chinpo",
        "cock",
        "dick",
        "ochinchin",
        "ochinpo",
        "peepee",
        "weewee",
      ],
    },
    "large penis": { keywords: ["big penis"] },
    testicles: { keywords: ["balls"] },
    pussy: { keywords: ["vagina", "vulva"] },
    barefoot: { keywords: ["barefeet"] },
    clitoris: { keywords: ["pussy", "vagina", "vulva"] },
    "pubic hair": {
      keywords: [
        "hairy anus",
        "hairy balls",
        "hairy pussy",
        "hairy testicles",
        "male pubic hair",
      ],
    },
    "female pubic hair": { keywords: ["hairy anus", "hairy pussy"] },
    "armpit hair": { keywords: ["hairy armpits"] },
    "excessive pubic hair": { keywords: ["female pubic hair"] },
    "anus hair": { keywords: ["anus pubic hair", "hairy anus"] },
    "female anus hair": { keywords: ["female anus pubic hair", "hairy anus"] },

    // Appearance
    "large breasts": {
      keywords: [
        "big boobs",
        "big breasts",
        "big tits",
        "large boobs",
        "large tits",
      ],
    },
    "animal ears": { keywords: ["kemonomimi"] },
    mole: { keywords: ["beauty mark"] },
    tan: { keywords: ["suntan"] },
    "blonde hair": { keywords: ["yellow hair"] },
    "gigantic breasts": { keywords: ["giant breasts"] },
    "fat man": { keywords: ["BBM", "太った男", "デブ男"] },
    "fat mons": { keywords: ["fat pussy"] },
    "sagging breasts": { keywords: ["saggy breasts"] },
    trap: { keywords: ["femboy"] },
    "demon girl": {
      description:
        "A female character with a demonic appearance. Typical characteristics include fangs, demon horns, glowing eyes, pointy ears, colored skin, colored sclera, claws, hooves, demon wings and long tails.\n\nSuccubi are often, if not nearly always, visually depicted as demon girls.",
    },
    teacher: {
      description:
        "A person who teaches students in a school.\n\nThe stereotypical depiction of a teacher wears a skirt suit and carries a pointer. You can use this tag when a character is dressed or portrayed as a teacher, not just when they canonically work as a teacher.",
    },
    tutor: {
      keywords: ["家庭教師"],
      description:
        "A private teacher, who gives private academic assistance to a student outside of school.",
    },
    tattoo: {
      keywords: ["タトゥー", "刺青"],
      description:
        "An application of permanent colour to the skin for the purpose of drawing a symbol or picture.",
    },
    "pubic tattoo": {
      keywords: ["crotch tattoo", "淫紋", "淫纹"],
      description:
        "A tattoo located on or just above the pubic area.\n\nThe most common design is the womb tattoo, a tattoo resembling a stylized heart or uterus. It symbolizes sexuality, promiscuity, or lust, and it may even glow or have the magical power of increasing the wearer's libido or fertility. It's sometimes used as a \"mark\" that the person belongs to someone.",
    },
    "large areolae": { keywords: ["big areolae"] },
    "huge ass": { keywords: ["big ass"] },
    "very short hair": {
      keywords: ["ベリーショート", "ベリショ"],
      description:
        "Hair that is ear or jaw length, or even shorter. Very short hairstyles include the buzz cut, crew cut, and pixie cut.",
    },
    "pixie cut": {
      keywords: ["very short hair"],
      description:
        "A women's hairstyle, cut very short (around cheek length or less) on the sides and back of the head, while slightly longer on top.\n\nThe amount of styling varies, but it is usually unstyled. The cut often includes swept bangs that are positioned close to the eyes, creating a flattering and accentuated facial profile. They are typically low-maintenance, require minimal styling, and are a practical option for those who lead active lifestyles.\n\nThe hairstyle is often commonly associated with tomboy characters.",
    },

    // Build
    loli: { keywords: ["lolicon"] },
    shota: { keywords: ["shotacon"] },
    "mature female": {
      keywords: [
        "housewife",
        "married woman",
        "milf",
        "hag",
        "熟女",
        "人妻",
        "ママン",
      ],
      description:
        "An attractive \"middle-aged\" woman. Common traits include slight face wrinkles, a noticeable belly, and an overall body shape that's generally curvier than that of a younger woman. Alternate terms, depending on age range, can include cougar, hag, or MILF (Mother I'd Like to Fuck; used regardless of the fact whether she's had children or not).",
    },
    mesugaki: {
      keywords: ["メスガキ"],
      description:
        'Literally, "bitch brat". A young girl who acts sassy and provocative towards adults in a sexually charged manner. Often qualifies for loli. The masculine equivalent is called "osugaki".\\n\\nTypical attributes include smug or naughty expressions, a teasing laugh, a single fang / skin fang, twintails, short shorts, miniskirts/microskirts, exposed midriff, calling people "zako", etc. May be an oppai loli.\\n\\nNot to be confused with erogaki ("erotic brat") who is sexually forward or seductive without being sassy, or kusogaki ("shitty brat") who is sassy without a sexual undertone.',
    },
    "mature male": {
      keywords: ["dilf", "uncle", "おじさん", "大叔", "オッサン", "熟男"],
      description:
        "Any older man who appears to be within the age range of 30-50. Does not need to be a father.",
    },

    // Gender

    // Meta
    decensored: { keywords: ["uncensored"] },

    // Language
    Chinese: { keywords: ["ZH", "CN", "中文"] },
    English: { keywords: ["EN"] },
    Japanese: { keywords: ["JP", "日本語"] },
    Korean: { keywords: ["KR", "한국어"] },
    Spanish: { keywords: ["ES", "Español"] },

    // Accessories
    piercing: {
      keywords: ["ピアス", "ボディピアス"],
      description:
        "An opening created in the body in which jewelry is worn.\n\nThis tag is for face and body piercings. This tag should not be used for ordinary earrings worn in the earlobes.",
    },
    earrings: {
      keywords: ["耳环", "piercing"],
      description:
        "An ornament or type of jewelry worn on the earlobes or in another ear piercing.",
    },
    "ear piercing": {
      description:
        "An ear piercing that is not through the earlobe.\n\nFor traditional lobe piercings, use earrings.",
    },
    "navel piercing": {
      keywords: ["へそピアス"],
      description: "A piercing through the navel.",
    },
    "nipple piercing": {
      keywords: ["乳首ピアス", "乳环"],
      description:
        "A piercing through the nipple. The most common types of nipple piercings are nipple bars or nipple rings.\nObjects that fit around the nipple instead of piercing them are nipple sleeves.",
    },
    sunglasses: {
      keywords: ["サングラス"],
      description:
        "A special kind of glasses which filter the very bright rays of the sun that enter the eyes. Also used to generally conceal one's eyes for any reason, medical or personal.",
    },
    "mouth mask": { keywords: ["face mask"] },

    // Objects
    "butt plug": { keywords: ["anal plug"] },

    // Clothing
    panties: { keywords: ["underwear"] },
    bra: { keywords: ["underwear"] },
    thighhighs: { keywords: ["stockings"] },
    thong: { keywords: ["underwear"] },
    "t-back": { keywords: ["underwear"] },
    "school uniform": { keywords: ["schoolgirl uniform"] },
    "bunny girl": {
      keywords: [
        "playboy bunny",
        "bunnysuit",
        "バニーガール",
        "バニースーツ",
        "バニー",
      ],
      description:
        'A woman wearing the uniform of a Playboy bunny (sometimes referred to unofficially as a "bunnysuit"). In Japan, the concept has been divorced from the Playboy brand, and they are simply known as "bunny girls".\n\nThe Playboy bunny uniform typically consists of a black strapless leotard (technically a corset), fake rabbit ears (usually in the form of a hairband), a fake rabbit tail, detached wrist cuffs, a white detached collar with a black bowtie, black or brown pantyhose, and black high heels. Common variations include substituting the pantyhose with fishnets or thighhighs, and the omission of any part of the outfit other than the ears and leotard.',
    },
    leotard: {
      keywords: ["レオタード", "紧身衣"],
      description:
        "A skin tight, one-piece bodysuit that covers the torso but leaves the legs free. They are usually sleeveless. They usually have a very simple design (often even just a single color), and are typically made of light fabrics to accommodate athletic activities. They are most often worn by acrobats, gymnasts, dancers, and circus performers.\n\nThey also influenced the one-piece swimsuit design, but swimsuits should not be tagged as leotards.",
    },

    // Other
    NTR: {
      keywords: ["cuckcoldry", "cuckold", "netorare", "寝取られ", "逆NTR"],
      description:
        "A fetish in which someone close to the protagonist is either willingly or unwillingly seduced and stolen away. This isn't necessarily limited to one's lover, but may also include friends, unrequited love interests, or even relatives.\n\nClosely related is netori/netoru (寝取り/寝取る). In this genre, the protagonist instead takes the lover of someone else. Also related is cuckolding, in which seeking out others is actively encouraged, even at the expense of the cuckold.",
    },
    cheating: {
      keywords: ["affair", "不倫", "浮気"],
      description:
        "Cheating, in a sexual sense, is having sex with someone other than one's regular partner in a monogamous relationship. When this happens among married people, this is known as adultery. This can also apply to meeting another without the regular partner knowing.",
    },
    "reverse NTR": { keywords: ["reverse netorare", "逆NTR"] },
    "multi-work series": {
      description:
        "A complete work whose story spans across multiple volumes, books, or releases.",
    },
    sweat: {
      keywords: ["sweating"],
      description:
        "Beads of perspiration that form on the body from physical exertion. Use this tag for light sweating (less than 5 drops). For heavy sweating, use very sweaty.\n\nFor large drops of sweat indicating nervousness or embarrassment in comedic situations, use sweatdrop or comedic sweatdrop.",
    },
    shibari: {
      keywords: ["縛り", "菱縄縛り", "緊縛", "紧缚"],
      description:
        'A type of elaborate Japanese rope bondage. Common features of shibari include intricate criss-crossed rope patterns tied around the body, ropes tied to apply pressure to a woman\'s breasts, and crotch ropes.\n\nShibari is Japanese for "to tie", originally an art of tying rope around objects in a visually appealing way. In modern times, shibari is now used to describe stylized bondage. In this case, it refers to any of a variety of intricate body ties originating in Japan.',
    },

    // Expressions
    ":>=": {
      keywords: [
        "ひょっとこフェラ",
        "バキュームフェラ",
        "blowjob face",
        "fellatio",
        "sucking cock",
        "sucking dick",
        "sucking penis",
        "vacuum face",
      ],
      description:
        "The emoticon that shows the lips being tugged forward on the backwards pull whilst sucking on something, as seen from an overhead or semi-overhead viewpoint. Typically this means fellatio, but it can also be seen when a character is sucking on a more innocuous object, such as a popsicle or pen.\n\nThe equivalent pixiv tags are ひょっとこフェラ (Hyottoko fellatio) or バキュームフェラ (Vacuum fellatio).",
    },
    aroused: {
      description:
        "When a character is sexually excited or stimulated. This can be through sex, oral, nipple sucking, touching, french kissing, mutual masturbation, heavy breathing or other intimate acts.",
    },
    "naughty face": {
      keywords: ["lewd expressions", "lewd face", "naughty expression"],
    },
    "rolling eyes": { keywords: ["ahegao"] },
    "heart-shaped pupils": {
      keywords: ["目がハート", "目にハート", "ハート目", "unusual pupils"],
    },
    "false smile": { keywords: ["fake smile"] },

    // Actions
    v: { keywords: ["piece sign"] },
    "double v": { keywords: ["double piece sign"] },
    kiss: { keywords: ["kissing"] },
    hug: { keywords: ["hugging"] },
    "french kiss": { keywords: ["french kissing"] },
    peeing: { keywords: ["urination"] },
    recording: { keywords: ["filming"] },
    vomit: { keywords: ["throw up"] },
    burp: { keywords: ["burping"] },
    fart: { keywords: ["farting"] },
    "licking foot": { keywords: ["licking feet"] },
    manspreading: { keywords: ["spread legs"] },
    "spread legs": { keywords: ["spreading legs"] },
    "m legs": { keywords: ["spread legs"] },
    "v legs": { keywords: ["spread legs"] },
    corruption: {
      keywords: ["moral degeneration"],
      description: "A character changing from good to evil, or pure to lewd.",
    },
    voyeurism: {
      keywords: ["出歯亀"],
      description:
        "Watching some else have sex or engage in other intimate activities such as undressing, showering, masturbating, or going to the bathroom.\n\nVoyeurism can either be done while unseen (peeking) or out in the open.\n\nThe opposite is exhibitionism.",
    },
    "breast expansion": {
      description:
        "When a character's breasts are shown to be growing or implied to have grown from a smaller to a much larger size.",
    },
    "bent over": {
      keywords: ["前かがみ", "前屈み"],
      description:
        "Legs (or at least thighs) vertical, with the torso bent over horizontally and ass sticking out.\n\nAs a rule of thumb, if the character is bent far enough forward that they need to rest their weight on something to avoid falling over, they are bent over, otherwise they are leaning forward.",
    },
    "leaning forward": {
      keywords: ["前屈み", "前かがみ"],
      description:
        "Angling the torso slightly forward, but not far enough to count as bent over. The character may have their hands on their knees or further up on their thighs as support.\n\nThis pose is often seen when undressing or to present cleavage or show downblouse.",
    },
    folded: {
      keywords: [
        "まんぐり返し",
        "ちんぐり返し",
        "屈曲位",
        "まんぐり",
        "マングリ返し",
        "まんぐりがえし",
      ],
      description:
        "A position where the upper legs are bent as far back as possible so that the person looks like they're folded in half. Frequently seen to accommodate sex acts.",
    },
    "choke hold": {
      keywords: ["チョークスリーパー"],
      description:
        "A choke hold, or stranglehold, is any type of unarmed strangulation technique used to submit an opponent or incapacitate a foe by restricting their airway (choking) or blood flow (strangulation). Choke holds are common in martial arts such as judo, Brazilian jiu-jitsu and sambo.",
    },
    asphyxiation: {
      keywords: ["窒息"],
      description:
        "When a person is unable to breathe for any reason; suffocation.\n\nThis includes choking on objects (such as food), drowning, being strangled by another person, or anything else that restricts breathing.",
    },
    strangling: {
      keywords: ["首絞め", "首絞めックス", "絞殺", "絞首"],
      description:
        "Squeezing or holding a person's neck to restrict their breathing. May be used as an attack to render someone unconscious, or as part of rough sex or BDSM play.\n\nIf the person is completely unable to breathe, then it's also asphyxiation.\n\nThe less violent form of this is hands on another's neck.\n\nNot to be confused with choking on object.",
    },
    "choking on object": {
      description:
        "Choking on something (normally food) stuck inside the windpipe/neck, blocking or restricting airflow.\n\nChoking is not the same thing as strangling. A strangle is from the outside the neck, a choke is from the inside the neck. Choking and strangling are different types of asphyxiation (being unable to breathe).",
    },
    straddling: {
      keywords: ["馬乗り"],
      description:
        "Sitting or resting with both legs on either side of something.",
    },
    "upright straddle": {
      keywords: ["対面座位"],
      description:
        "Straddling another person while that person is sitting upright. May involve a leg lock. In the Kama Sutra, this position is known as the Lotus Blossom position.",
    },
    "sitting on lap": {
      keywords: ["膝の上に座る", "膝乗り"],
      description: "Sitting on another person's lap.",
    },
    "lap pillow": {
      keywords: ["膝枕", "膝枕幸せサンドイッチ"],
      description: "When someone's head is resting in someone else's lap.",
    },

    // Sex Acts
    vaginal: { keywords: ["vaginal sex"] },
    anal: { keywords: ["anal sex"] },
    fellatio: {
      keywords: ["blowjob", "sucking cock", "sucking dick", "sucking penis"],
    },
    paizuri: {
      keywords: ["breasts job", "titjob", "tits job"],
      description:
        'A sex act in which a person (male or futanari) has their penis rubbed in the cleavage between their partner\'s breasts. Also known as "titty fucking" or "mammary intercourse". On Danbooru, the Japanese term \'paizuri\' (ぱいずり) is used.\n\nIf the penis is long enough, fellatio may also be involved at the same time.\n\nIf "paizuri" is performed on an object instead of a penis, use the tag "simulated paizuri" instead.',
    },
    "cooperative paizuri": {
      keywords: ["Wパイズリ", "ダブルパイズリ", "トリプルパイズリ"],
      description:
        "Paizuri with two or more girls actively stimulating a penis with their breasts.\n\nFor one girl performing paizuri on multiple penises at the same time, use double paizuri.",
    },
    "double paizuri": {
      description:
        "Paizuri performed on two penises at the same time.\n\nFor two or more girls performing paizuri on one penis at the same time, use cooperative paizuri.",
    },
    "handsfree paizuri": {
      keywords: ["ノーハンドパイズリ"],
      description:
        "Paizuri where neither of the participants use their hands or arms to touch the breasts.",
    },
    "paizuri over clothes": {
      keywords: ["布越しパイズリ"],
      description:
        "When paizuri is performed over the top of/through clothing, with no skin contact.\n\nIf the character is merely clothed while performing traditional paizuri (with skin contact), use paizuri under clothes instead.",
    },
    "paizuri under clothes": {
      keywords: ["着衣パイズリ", "ブラ着パイズリ"],
      description:
        "When paizuri is performed while clothed.\n\nIf paizuri is performed over the top of/through clothing, with no skin contact, use paizuri over clothes instead.",
    },
    "straddling paizuri": {
      keywords: ["馬乗りパイズリ"],
      description:
        "A variation of paizuri where the person with the penis sits on top of the woman and fucks the tits themselves.",
    },
    naizuri: {
      keywords: [
        "ちっぱいズリ",
        "ナイズリ",
        "small breasts paizuri",
        "flat chest paizuri",
        "flat chest titjob",
        "small breasts titjob",
        "small breasts job",
        "small tits job",
      ],
      description:
        'An attempt at paizuri with insufficient cleavage.\n\nEtymology: 無い擦り = lit. "rubbing against nothing" or "not-there rub".',
    },
    footjob: { keywords: ["feetjob"] },
    glansjob: {
      keywords: ["handjob", "亀頭責め"],
      description:
        "A sex act in which mainly the head of the penis is stimulated, the shaft is not touched or only for holding.\n\nThis often takes the form of a handjob where the palm is used to rub the head in circles, or a cloth glansjob where a taut piece of cloth is used to rub it back and forth. It can also be accomplished by performing fellatio on the head of the penis.\n\nIf there's any penetration involved, use just the tip instead.",
    },
    "cloth glansjob": {
      keywords: ["ローションガーゼ"],
      description:
        "A method of stimulating the glans by rubbing with a taut piece of cloth, often gauze or panties.",
    },
    "just the tip": {
      keywords: ["先っちょ入れ"],
      description:
        "Any sexual act in which only the tip of a penis is penetrating the subject. This also includes imminent penetration. If there's no penetration involved, use glansjob instead.",
    },
    groping: {
      keywords: ["揉む", "愛撫"],
      description:
        "Touching or fondling another person in a sexual way, usually the breasts or ass.",
    },
    anilingus: {
      keywords: ["アナル舐め", "rimjob", "anus licking", "butthole licking"],
    },
    "rusty trombone": {
      keywords: [
        "anilingus",
        "anus licking",
        "butthole licking",
        "handjob",
        "oral",
      ],
      description:
        "Performing anilingus on a male partner while giving him a handjob at the same time. Named after the mouth piece and sliding arm of the brass instrument, the trombone.",
    },
    "breast sucking": { keywords: ["nipple sucking"] },
    cunnilingus: { keywords: ["licking pussy", "pussy lick"] },
    irrumatio: {
      keywords: [
        "deepthroat",
        "thrusting penis into mouth",
        "thrusting penis into throat",
      ],
      description:
        "A type of oral sexual intercourse performed by someone actively thrusting their penis into their partner's mouth and possibly their throat.\n\nThe distinction between fellatio and irrumatio is based on who is actively moving: irrumatio means to thrust the penis into the partner's mouth, while fellatio means to move the head and mouth up-and-down around the penis. For tentacle sex, use mouth insertion instead.\n\nThe word comes from the Latin irrumāre, which had the same definition; although to the Romans it specifically connoted non-consensuality, which is not always the case in English.",
    },
    "licking testicle": {
      keywords: [
        "ball licking",
        "balls licking",
        "balls sucking",
        "licking balls",
      ],
    },
    "testicle sucking": {
      keywords: [
        "ball sucking",
        "balls sucking",
        "licking balls",
        "sucking balls",
      ],
    },
    "reverse spitroast": { keywords: ["ffm threesome"] },
    "cervical penetration": { keywords: ["cervix penetration"] },
    "stomach bulge": { keywords: ["stomach deformation"] },
    "large testicles": {
      keywords: ["big balls", "big testicles", "large balls"],
    },
    gaping: { keywords: ["open anus", "spread anus"] },
    "cum in pussy": { keywords: ["nakadashi", "vaginal creampie"] },
    "cum in ass": { keywords: ["anal creampie", "cum in anus"] },
    "female ejaculation": { keywords: ["squirting"] },
    erection: { keywords: ["boner"] },
    facial: { keywords: ["cum on face"] },
    gokkun: {
      keywords: [
        "drinking cum",
        "drinking semen",
        "swallow cum",
        "swallow semen",
      ],
    },
    "penis awe": { keywords: ["penis shock"] },
    "blank censor": { keywords: ["full censorship"] },
    "mosaic censoring": { keywords: ["mosaic censorship"] },
    "group sex": {
      keywords: ["group"],
      description:
        "Group sex is any sex act involving more than two participants at the same time.",
    },
    lactation: {
      keywords: ["milking"],
      description:
        "When milk is secreted from a woman's breasts.\nThis tag does not signify pregnant",
    },
    impregnation: {
      description:
        "Either an actual depiction of a sperm cell hitting an egg, or a scene where the female is saying that she will become pregnant as a result of being cummed inside.",
    },
    "stealth sex": {
      keywords: ["隠姦", "hidden sex"],
      description:
        "Discreetly engaging in any kind of sex act in the presence of other people, so as to prevent those people from realizing that the act is occurring. When this occurs in a public place, it may be a type of public indecency. Note that not all stealth sex takes place in public.",
    },
    toddlercon: { keywords: ["loli", "lolicon"] },
    "suspended congress": {
      keywords: ["駅弁ファック"],
      description:
        "A sexual position in which the penetrating partner lifts the receiving partner off their feet. The penetrating partner lifts the receiving partner and penetrates them in the air. The penetrating partner can be a man, futanari, woman with a strap-on, etc.",
    },
    "reverse suspended congress": {
      keywords: ["アナル固め", "駅弁", "背面駅弁", "逆駅弁"],
      description:
        "A sex position in which a person is held in midair while being penetrated from behind.\n\nOften accompanied by a full nelson when the receiver is held by the back of the neck.",
    },
    "full nelson": {
      keywords: ["フルネルソン"],
      description:
        "A wrestling hold in which a person is restrained from behind, with both arms wrapped under the opponent's armpits and the hands are held on the back of the neck.\n\nOriginally named after a wrestling move, but most often seen with the reverse suspended congress sex position, where the person is folded in half and their legs are held back by the knees instead of being held under the armpits.\n\nThis appears very similar to the lesser-used locked legs restraining pose, but the restrainer is using their own legs to pin their opponent's legs, not their arms.",
    },
    "locked legs": {
      keywords: ["戸川固め", "まんぐり固め"],
      description:
        "A restraining pose where one person lies on their back with both legs raised toward their head in the folded position, and the other person places their legs on top of those legs, pressing them down from the head side to hold them in place.\n\nNot to be confused with full nelson, where the restrainer's arms are used to hold their opponent's legs. This involves the restrainer using their legs.",
    },
    "reverse upright straddle": {
      keywords: ["背面座位"],
      description:
        "A sex position for two characters sitting upright in which the receiving partner sits on or astride the penetrating partner's lap, getting penetrated from behind. Compare to upright straddle, in which the participants face each other. If the penetrating partner is lying on his or her back, this becomes the reverse cowgirl position.\n\nAlso known as the champagne room position.",
    },
    "implied sex": {
      keywords: ["これ絶対入ってるよね"],
      description:
        "When sexual intercourse is implied to be taking place, but is not immediately obvious due to not being shown explicitly on the image, such as the penetration being obscured or that only the character dialogue is present and is hinting that sex is taking place.\n\nWhen the character is clearly being shown to have been sexually penetrated but the source of penetration is not shown (such as being out of the frame), simply tag sex instead.",
    },
    "69": {
      keywords: ["シックスナイン"],
      description:
        "Generally, a sexual position where each partner has the other's crotch in their face. Fellatio and/or cunnilingus are often performed in this position (often mutually).",
    },
    "standing missionary": {
      keywords: ["対面立位"],
      description:
        "A form of standing sex where both partners have sex while facing each other and standing on both feet.",
    },
    grinding: {
      keywords: ["素股", "股コキ"],
      description:
        "A sex act in which a girl grinds her bare or covered pussy against her partner's penis without being penetrated.\n\nThis is different from imminent vaginal. In imminent vaginal, the penis is angled to penetrate, while in grinding, the pussy is simply rubbed against the penis with no apparent intention to penetrate.",
    },
    buttjob: {
      keywords: ["尻コキ"],
      description:
        "A sex act in which a person grinds their ass against their partner's penis without being penetrated.\n\nFor pussy-to-penis rubbing, use grinding instead.\n\nDuring a buttjob the penis should be facing towards the partner's upper body, if it is pointing towards their lower body then use reverse buttjob instead.",
    },
    "cooperative grinding": {
      keywords: ["W素股"],
      description:
        "Two or more women grinding their pussies against their partner's penis, without being penetrated.",
    },
    "kneepit sex": {
      keywords: ["膝裏コキ"],
      description:
        "Rubbing a penis inside another person's kneepit.\n\nThis tag is somewhat of a misnomer because while the word sex is used, it shouldn't be tagged as such as well. Sex is only when the penis is inserted into the vaginal or anal cavities.",
    },
    "thigh sex": {
      keywords: [
        "素股",
        "太ももコキ",
        "すまた",
        "スマタ",
        "thigh job",
        "thighjob",
      ],
      description:
        "A sex act in which a person rubs their penis in between their partner's closed thighs. Also known as intercrural or interfemoral sex, or sometimes by the Japanese term 'sumata' (すまた).\n\nNot to be confused with kneepit sex or thigh straddling. Use grinding instead when the penis is rubbed directly on the pussy instead of between the thighs.\n\nThis tag is somewhat of a misnomer because while the word sex is used, it shouldn't be tagged as such as well. Sex is only when the penis is inserted into the vaginal or anal cavities.",
    },
  };

  const upsertTag = db.prepare(`
    INSERT INTO tags (name, category_id, description, is_default)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      category_id = excluded.category_id
    WHERE is_default = 1
  `);

  const deleteDefaultAliases = db.prepare(`
    DELETE FROM tag_aliases 
    WHERE tag_id = ? 
    AND tag_id IN (SELECT id FROM tags WHERE is_default = 1)
  `);

  const insertAliasOrdered = db.prepare(
    "INSERT OR IGNORE INTO tag_aliases (tag_id, alias, sort_order) VALUES (?, ?, ?)",
  );

  const insertTagOnly = db.prepare(`
    INSERT OR IGNORE INTO tags (name, category_id, description, is_default)
    VALUES (?, ?, ?, 1)
  `);

  const syncDefaults = options.syncDefaults !== false;

  const getTagId = db.prepare("SELECT id FROM tags WHERE name = ?");
  const findCat = db.prepare("SELECT id FROM categories WHERE name = ?");

  db.transaction(() => {
    for (const [name, catName] of defaults) {
      const cat = findCat.get(catName) as { id: number } | undefined;
      const meta = defaultTagMeta[name];
      const description = meta?.description ?? null;

      // Sync tag metadata
      if (syncDefaults) {
        upsertTag.run(name, cat ? cat.id : null, description);
      } else {
        insertTagOnly.run(name, cat ? cat.id : null, description);
      }

      const tagRow = getTagId.get(name) as { id: number } | undefined;
      if (!tagRow) continue;

      // Full-sync aliases for default tags
      if (syncDefaults) {
        deleteDefaultAliases.run(tagRow.id);
        if (meta?.keywords && meta.keywords.length > 0) {
          for (let i = 0; i < meta.keywords.length; i++) {
            insertAliasOrdered.run(tagRow.id, meta.keywords[i], i);
          }
        }
      } else {
        // Just additive
        if (meta?.keywords && meta.keywords.length > 0) {
          for (let i = 0; i < meta.keywords.length; i++) {
            insertAliasOrdered.run(tagRow.id, meta.keywords[i], i);
          }
        }
      }
    }

    // Ensure all known default tags are marked
    const allDefaultTagNames = defaults.map((d) => d[0]);
    const markDefault = db.prepare(
      "UPDATE tags SET is_default = 1 WHERE name = ?",
    );
    for (const name of allDefaultTagNames) {
      markDefault.run(name);
    }
  })();
}
