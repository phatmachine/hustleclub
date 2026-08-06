// ============================================================
// HUSTLE CLUB — RECALL CODES
// A code is three wholesome words: "sun-dance-flower".
// It is the ONLY key to a saved conversation, so a teen can walk
// away on one device and come back on another — which is the whole
// reason the SQLite store exists (see sessions.js).
//
// ⚠️ WHY THE WORD LISTS LOOK THE WAY THEY DO
// Every word is readable out loud by a 14-year-old, spells one
// obvious way, and cannot combine into anything a parent would mind
// reading. That rules out more than rude words: no homophone traps
// (bare/bear), no words that turn crude next to a body part, no
// brands, no violence, nothing scary. If you add a word, say all
// three slots out loud with it before you commit.
//
// Lists are deliberately the same length and shape so the code reads
// with a rhythm — bright thing, creature or action, treat or plant.
//
// ⚠️ A CODE IS A BEARER TOKEN, NOT A PASSWORD.
// Three lists of 96 is 884,736 codes — readable enough to say down a
// phone, and nowhere near enough to stop a script on its own. What
// stops a script is the lookup rate limit in server.js. If you loosen
// that limit, or lengthen the lists instead of fixing it, you have
// misunderstood the control. Never put anything in a session that
// would harm the teen if a stranger read it; the guardrails already
// keep surnames, addresses, schools and phone numbers out of the
// conversation, and that is what makes this trade-off acceptable.
// ============================================================

/** Bright, cheerful things. */
const FIRST = [
  'sun', 'moon', 'star', 'sky', 'cloud', 'rain', 'snow', 'wind',
  'river', 'ocean', 'lake', 'creek', 'hill', 'valley', 'meadow', 'forest',
  'island', 'harbour', 'garden', 'orchard', 'sunrise', 'sunset', 'rainbow', 'comet',
  'gold', 'silver', 'copper', 'amber', 'coral', 'jade', 'ruby', 'pearl',
  'happy', 'sunny', 'merry', 'jolly', 'bright', 'shiny', 'sparkly', 'glowing',
  'clever', 'brave', 'bold', 'kind', 'gentle', 'lucky', 'cosy', 'comfy',
  'swift', 'nimble', 'zippy', 'breezy', 'bouncy', 'giggly', 'cheery', 'chirpy',
  'velvet', 'poplar', 'maple', 'cedar', 'willow', 'aspen', 'birch', 'juniper',
  'summer', 'autumn', 'spring', 'winter', 'morning', 'evening', 'midday', 'twilight',
  'crystal', 'marble', 'lantern', 'compass', 'anchor', 'beacon', 'pebble', 'boulder',
  'crimson', 'scarlet', 'indigo', 'violet', 'teal', 'olive', 'lilac', 'peach',
  'mellow', 'cheerful', 'peaceful', 'joyful', 'playful', 'hopeful', 'grateful', 'radiant',
];

/** Creatures and things they do. */
const SECOND = [
  'dance', 'skip', 'hop', 'leap', 'glide', 'soar', 'swoop', 'dash',
  'wander', 'ramble', 'roam', 'stroll', 'paddle', 'sail', 'drift', 'float',
  'giggle', 'chuckle', 'whistle', 'hum', 'sing', 'cheer', 'clap', 'shout',
  'sparkle', 'shimmer', 'glimmer', 'twinkle', 'flicker', 'glow', 'gleam', 'shine',
  'dog', 'cat', 'fox', 'owl', 'bear', 'deer', 'otter', 'seal',
  'robin', 'sparrow', 'swallow', 'heron', 'puffin', 'penguin', 'toucan', 'parrot',
  'rabbit', 'badger', 'hedgehog', 'squirrel', 'beaver', 'panda', 'koala', 'llama',
  'dolphin', 'turtle', 'starfish', 'seahorse', 'octopus', 'jellyfish', 'minnow', 'guppy',
  'bumblebee', 'ladybug', 'firefly', 'cricket', 'dragonfly', 'butterfly', 'grasshopper', 'snail',
  'pony', 'foal', 'lamb', 'calf', 'duckling', 'gosling', 'piglet', 'kitten',
  'juggle', 'tumble', 'wiggle', 'jiggle', 'bounce', 'wobble', 'scamper', 'scurry',
  'gallop', 'trot', 'canter', 'prance', 'waltz', 'jive', 'boogie', 'shuffle',
];

/** Treats, plants and small good things. */
const THIRD = [
  'flower', 'daisy', 'tulip', 'poppy', 'lily', 'iris', 'clover', 'fern',
  'blossom', 'petal', 'leaf', 'acorn', 'pinecone', 'seedling', 'sapling', 'sprout',
  'jam', 'honey', 'syrup', 'toffee', 'fudge', 'nougat', 'caramel', 'marzipan',
  'icecream', 'sorbet', 'gelato', 'sundae', 'milkshake', 'smoothie', 'lemonade', 'cordial',
  'cookie', 'brownie', 'muffin', 'scone', 'crumpet', 'pancake', 'waffle', 'donut',
  'cupcake', 'pavlova', 'meringue', 'shortbread', 'gingerbread', 'flapjack', 'biscuit', 'pastry',
  'apple', 'pear', 'plum', 'peach', 'cherry', 'apricot', 'mango', 'papaya',
  'berry', 'blueberry', 'raspberry', 'strawberry', 'blackberry', 'gooseberry', 'cranberry', 'currant',
  'lemon', 'lime', 'orange', 'melon', 'kiwi', 'banana', 'coconut', 'pineapple',
  'walnut', 'hazelnut', 'almond', 'pecan', 'cashew', 'chestnut', 'peanut', 'pistachio',
  'mitten', 'blanket', 'pillow', 'teapot', 'kettle', 'basket', 'ribbon', 'button',
  'balloon', 'bubble', 'marble', 'kite', 'puzzle', 'crayon', 'sticker', 'postcard',
];

export const WORD_LISTS = [FIRST, SECOND, THIRD];

/** Every word that may legally appear, per slot. Used to validate. */
const SLOT_SETS = WORD_LISTS.map((list) => new Set(list));

/** How many distinct codes exist. Logged at boot so the number is never a guess. */
export const CODE_SPACE = WORD_LISTS.reduce((n, list) => n * list.length, 1);

/**
 * A cryptographically random index in [0, n).
 *
 * Math.random() would be fine for readability but not for a value
 * that acts as a bearer token — rejection sampling off crypto keeps
 * the distribution flat and the source unguessable.
 */
function pick(list, randomBytes) {
  const n = list.length;
  const limit = Math.floor(256 / n) * n; // reject the ragged tail
  for (;;) {
    const b = randomBytes(1)[0];
    if (b < limit) return list[b % n];
  }
}

/**
 * Make a fresh code. `randomBytes` is injected so this file stays
 * free of node imports and can be unit-tested with a fixed source.
 */
export function makeCode(randomBytes) {
  return WORD_LISTS.map((list) => pick(list, randomBytes)).join('-');
}

/**
 * Is this a code we could ever have issued?
 *
 * Checked BEFORE the database is touched, so a lookup for garbage
 * never becomes a query. Case and surrounding whitespace are
 * forgiven because teens will type these off a printed page; nothing
 * else is.
 */
export function normaliseCode(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, '-');
  const parts = s.split('-').filter(Boolean);
  if (parts.length !== WORD_LISTS.length) return null;
  for (let i = 0; i < parts.length; i++) {
    if (!SLOT_SETS[i].has(parts[i])) return null;
  }
  return parts.join('-');
}
