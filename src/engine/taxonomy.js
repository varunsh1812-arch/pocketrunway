// Spend categories and the merchant knowledge the rule layer and the demo data share.

export const CATEGORIES = [
  { id: "food_delivery", label: "Food delivery", short: "Delivery" },
  { id: "eating_out", label: "Canteen & eating out", short: "Eating out" },
  { id: "groceries", label: "Groceries & essentials", short: "Groceries" },
  { id: "travel", label: "Travel", short: "Travel" },
  { id: "shopping", label: "Shopping", short: "Shopping" },
  { id: "entertainment", label: "Entertainment", short: "Fun" },
  { id: "bills", label: "Recharge & subscriptions", short: "Bills" },
  { id: "education", label: "Study & printouts", short: "Study" },
  { id: "health", label: "Health & fitness", short: "Health" },
  { id: "friends", label: "Friends & splits", short: "Friends" },
  { id: "other", label: "Other", short: "Other" },
];
export const INCOME = { id: "income", label: "Money in", short: "Money in" };
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const catLabel = (id) => (id === "income" ? INCOME.label : CATEGORIES.find((c) => c.id === id)?.label ?? "Other");
export const catShort = (id) => (id === "income" ? INCOME.short : CATEGORIES.find((c) => c.id === id)?.short ?? "Other");

/**
 * Known brands. `keys` are matched as whole words against the cleaned merchant text.
 * Order matters: more specific entries (Instamart, Prime) come before the parent brand.
 * `vpa` and `bank` are only used to make the demo statement look like a real one.
 */
export const BRANDS = [
  { name: "SWIGGY INSTAMART", keys: ["instamart"], cat: "groceries", vpa: "instamart@icici", bank: "ICIC" },
  { name: "AMAZON PRIME", keys: ["amazon prime", "prime video"], cat: "bills", vpa: "amazonprime@apl", bank: "UTIB" },
  { name: "GOOGLE PLAY", keys: ["google play", "youtube premium", "youtube"], cat: "bills", vpa: "playstore@axisbank", bank: "UTIB" },
  { name: "SWIGGY", keys: ["swiggy"], cat: "food_delivery", vpa: "swiggy@icici", bank: "ICIC" },
  { name: "ZOMATO", keys: ["zomato"], cat: "food_delivery", vpa: "zomato.order@hdfcbank", bank: "HDFC" },
  { name: "EATSURE", keys: ["eatsure"], cat: "food_delivery", vpa: "eatsure@ybl", bank: "YESB" },
  { name: "DOMINOS PIZZA", keys: ["dominos", "domino"], cat: "food_delivery", vpa: "dominos@hdfcbank", bank: "HDFC" },
  { name: "BLINKIT", keys: ["blinkit", "grofers"], cat: "groceries", vpa: "blinkit@hdfcbank", bank: "HDFC" },
  { name: "ZEPTO", keys: ["zepto", "kiranakart"], cat: "groceries", vpa: "zepto@ybl", bank: "YESB" },
  { name: "BIGBASKET", keys: ["bigbasket", "bbnow"], cat: "groceries", vpa: "bigbasket@icici", bank: "ICIC" },
  { name: "DMART", keys: ["dmart", "avenue supermarts"], cat: "groceries", vpa: "dmart@kotak", bank: "KKBK" },
  { name: "JIOMART", keys: ["jiomart"], cat: "groceries", vpa: "jiomart@sbi", bank: "SBIN" },
  { name: "RAPIDO", keys: ["rapido", "roppen"], cat: "travel", vpa: "rapido@ybl", bank: "YESB" },
  { name: "UBER INDIA", keys: ["uber"], cat: "travel", vpa: "uber@axisbank", bank: "UTIB" },
  { name: "OLA CABS", keys: ["ola", "ani technologies"], cat: "travel", vpa: "olacabs@icici", bank: "ICIC" },
  { name: "IRCTC", keys: ["irctc"], cat: "travel", vpa: "irctc@sbi", bank: "SBIN" },
  { name: "REDBUS", keys: ["redbus"], cat: "travel", vpa: "redbus@icici", bank: "ICIC" },
  { name: "METRO CARD RECHARGE", keys: ["metro", "dmrc", "bmrcl"], cat: "travel", vpa: "metrocard@sbi", bank: "SBIN" },
  { name: "AMAZON", keys: ["amazon", "amzn"], cat: "shopping", vpa: "amazon@apl", bank: "UTIB" },
  { name: "FLIPKART", keys: ["flipkart"], cat: "shopping", vpa: "flipkart@axisbank", bank: "UTIB" },
  { name: "MYNTRA", keys: ["myntra"], cat: "shopping", vpa: "myntra@icici", bank: "ICIC" },
  { name: "MEESHO", keys: ["meesho"], cat: "shopping", vpa: "meesho@ybl", bank: "YESB" },
  { name: "AJIO", keys: ["ajio"], cat: "shopping", vpa: "ajio@sbi", bank: "SBIN" },
  { name: "NYKAA", keys: ["nykaa"], cat: "shopping", vpa: "nykaa@hdfcbank", bank: "HDFC" },
  { name: "DECATHLON", keys: ["decathlon"], cat: "shopping", vpa: "decathlon@icici", bank: "ICIC" },
  { name: "BOOKMYSHOW", keys: ["bookmyshow", "bigtree"], cat: "entertainment", vpa: "bookmyshow@hdfcbank", bank: "HDFC" },
  { name: "PVR INOX", keys: ["pvr", "inox"], cat: "entertainment", vpa: "pvrinox@icici", bank: "ICIC" },
  { name: "STEAM", keys: ["steam", "valve"], cat: "entertainment", vpa: "steam@axisbank", bank: "UTIB" },
  { name: "JIO PREPAID", keys: ["jio", "reliance jio"], cat: "bills", vpa: "jio@sbi", bank: "SBIN" },
  { name: "AIRTEL", keys: ["airtel"], cat: "bills", vpa: "airtel@ybl", bank: "YESB" },
  { name: "SPOTIFY", keys: ["spotify"], cat: "bills", vpa: "spotify@hdfcbank", bank: "HDFC" },
  { name: "NETFLIX", keys: ["netflix"], cat: "bills", vpa: "netflix@icici", bank: "ICIC" },
  { name: "CHAAYOS", keys: ["chaayos"], cat: "eating_out", vpa: "chaayos@ybl", bank: "YESB" },
  { name: "STARBUCKS", keys: ["starbucks", "tata starbucks"], cat: "eating_out", vpa: "starbucks@hdfcbank", bank: "HDFC" },
  { name: "MCDONALDS", keys: ["mcdonalds", "mcdonald"], cat: "eating_out", vpa: "mcdonalds@icici", bank: "ICIC" },
  { name: "HALDIRAMS", keys: ["haldiram", "haldirams"], cat: "eating_out", vpa: "haldirams@sbi", bank: "SBIN" },
  { name: "CHAI POINT", keys: ["chai point"], cat: "eating_out", vpa: "chaipoint@ybl", bank: "YESB" },
  { name: "APOLLO PHARMACY", keys: ["apollo"], cat: "health", vpa: "apollopharmacy@icici", bank: "ICIC" },
  { name: "PHARMEASY", keys: ["pharmeasy"], cat: "health", vpa: "pharmeasy@ybl", bank: "YESB" },
  { name: "TATA 1MG", keys: ["1mg"], cat: "health", vpa: "tata1mg@hdfcbank", bank: "HDFC" },
  { name: "CULT FIT", keys: ["cult", "cultfit", "curefit"], cat: "health", vpa: "cultfit@icici", bank: "ICIC" },
  { name: "COURSERA", keys: ["coursera"], cat: "education", vpa: "coursera@axisbank", bank: "UTIB" },
  { name: "UNACADEMY", keys: ["unacademy"], cat: "education", vpa: "unacademy@ybl", bank: "YESB" },
  { name: "UDEMY", keys: ["udemy"], cat: "education", vpa: "udemy@icici", bank: "ICIC" },
];

/**
 * Local, unbranded merchants. These never go through the brand rules; the
 * Naive Bayes model has to recognise them from the words in their names.
 * The model is evaluated on merchants it never saw during training.
 */
export const LOCAL_MERCHANTS = {
  eating_out: [
    "CAMPUS CANTEEN", "GUPTA CHAI CORNER", "ANNAPURNA DHABA", "HOSTEL MESS EXTRA", "SHARMA SWEETS", "KAVERI CAFE",
    "BALAJI TIFFIN CENTRE", "MOMO POINT", "CHAI SUTTA BAR", "SAGAR RATNA", "BIKANERVALA", "RAJU JUICE CENTRE",
    "PARATHA HOUSE", "THE COFFEE CORNER", "NESCAFE KIOSK", "SOUTH INDIAN CAFE", "BURGER HUB", "ROLL POINT",
    "AGARWAL BHOJNALAYA", "SHIVA RESTAURANT", "TEA STALL GATE 2", "FOOD COURT", "MAGGI POINT", "KATHI ROLLS CORNER",
  ],
  groceries: [
    "SHARMA GENERAL STORE", "OM KIRANA STORE", "BALAJI SUPERMARKET", "NEW FRESH MART", "GUPTA PROVISION STORE",
    "CAMPUS DAILY NEEDS", "RELIANCE SMART", "MORE SUPERMARKET", "SPENCERS RETAIL", "VISHAL MEGA MART",
    "PATEL DAIRY", "AMUL PARLOUR", "FRUIT AND VEG MART", "MAHALAXMI KIRANA", "STAR BAZAAR", "EASYDAY STORE",
    "JAI MATA DI GENERAL STORE", "NATURE BASKET", "MILK BOOTH", "DAILY BASKET",
  ],
  travel: [
    "SHREE GANESH TRAVELS", "CITY AUTO STAND", "INDIAN OIL PETROL PUMP", "HP PETROL PUMP", "BHARAT PETROLEUM",
    "KRISHNA TOURS AND TRAVELS", "ABHIBUS", "STATE TRANSPORT BUS", "E RICKSHAW STAND", "NAMMA YATRI",
    "BLUSMART", "YULU BIKES", "ZOOMCAR", "BOUNCE RIDES", "SHARMA TRAVELS",
  ],
  shopping: [
    "ZUDIO", "MAX FASHION", "PANTALOONS", "WESTSIDE", "LIFESTYLE STORES", "BATA SHOES", "CROMA", "RELIANCE DIGITAL",
    "LENSKART", "TRENDS FOOTWEAR", "CAMPUS FASHION HUB", "MOBILE ACCESSORIES POINT", "GIFT GALLERY", "H AND M",
    "SKECHERS", "BOAT LIFESTYLE",
  ],
  entertainment: [
    "TIMEZONE GAMING", "SMAAASH", "FUN CITY", "BOWLING ALLEY", "CINEPOLIS", "MIRAJ CINEMAS", "INSIDER EVENTS",
    "PAYTM INSIDER", "WONDERLA", "GAMING ZONE", "STAND UP COMEDY SHOW", "CONCERT TICKETS",
  ],
  bills: [
    "VI PREPAID", "BSNL MOBILE", "ACT FIBERNET", "TATA PLAY", "DISNEY HOTSTAR", "SONYLIV", "ZEE5", "APPLE SERVICES",
    "GOOGLE ONE", "JIOCINEMA PREMIUM", "ELECTRICITY BILL", "WIFI RECHARGE",
  ],
  education: [
    "XEROX POINT", "PRINT AND XEROX CENTRE", "SAPNA BOOK HOUSE", "CAMPUS STATIONERY", "KITAB GHAR", "PHOTOSTAT SHOP",
    "CHEGG INDIA", "BYJUS", "PHYSICS WALLAH", "BOOK DEPOT", "NOTEBOOK AND PEN STORE", "EXAM FORM FEE",
    "LIBRARY FINE", "SKILLSHARE",
  ],
  health: [
    "OM SAI MEDICAL STORE", "MEDPLUS", "NETMEDS", "WELLNESS FOREVER", "CITY HOSPITAL", "DR GUPTA CLINIC",
    "FITNESS FIRST GYM", "GOLD GYM", "DENTAL CARE CLINIC", "PATH LABS", "SHREE MEDICOS", "GUARDIAN PHARMACY",
  ],
};

export const PEOPLE = [
  ["ADITI KAPOOR", "aditi.kapoor@oksbi", "SBIN"],
  ["RAHUL VERMA", "rahulv@okaxis", "UTIB"],
  ["SNEHA IYER", "sneha.iyer@okicici", "ICIC"],
  ["KARAN MALHOTRA", "karanm@ybl", "YESB"],
  ["PRIYA NAIR", "priyanair@okhdfcbank", "HDFC"],
  ["ARJUN REDDY", "arjun.r@oksbi", "SBIN"],
  ["NEHA SINGH", "nehasingh@paytm", "PYTM"],
  ["ROHAN DAS", "rohandas@okaxis", "UTIB"],
  ["ISHA PATEL", "isha.p@ibl", "ICIC"],
  ["VIKRAM JOSHI", "vikramj@okicici", "ICIC"],
];
export const PARENT = ["ANITA MEHTA", "anita.mehta@okhdfcbank", "HDFC"];
