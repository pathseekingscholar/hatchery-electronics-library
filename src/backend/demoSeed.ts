// FICTIONAL demo data for the local preview. This is NOT the Hatchery's inventory or layout.
// Several part names come from the legacy Eagle Circuit Library sample list.
import type { Catalog, Category, CommunityPost, Location, Member, Part, StockEntry, StockStatus } from '../lib/types'

const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString()

const categoryNames = [
  'Resistors', 'Capacitors', 'Diodes', 'LEDs & Lighting', 'Transistors', 'ICs', 'Microcontrollers',
  'Sensors', 'Motors & Drivers', 'Power', 'Switches & Buttons', 'Connectors', 'Displays', 'Audio',
  'Wireless', 'Cables & Wire', 'Tools & Misc',
]

export function makeDemoCatalog(): Catalog {
  const categories: Category[] = categoryNames.map((name, i) => ({ id: `cat-${i + 1}`, name, sort: (i + 1) * 10 }))
  const cat = (name: string) => categories.find((c) => c.name === name)!.id

  const loc = (id: string, parentId: string | null, kind: string, name: string, code: string, sort = 0): Location => ({
    id, parentId, kind, name, code, sort, description: '',
    photoUrl: null, thumbUrl: null, photoPath: null, thumbPath: null, reviewedAt: null, reviewedByName: null,
  })
  const locations: Location[] = [
    loc('l-room', null, 'Room', 'Demo Room', 'DEMO'),
    loc('l-cab-a', 'l-room', 'Cabinet', 'Cabinet A (passives)', 'A', 1),
    loc('l-a01', 'l-cab-a', 'Drawer', 'Drawer 1 — resistors under 1 kΩ', 'A-01', 1),
    loc('l-a01-b1', 'l-a01', 'Bin', 'Bin 1', 'A-01-1', 1),
    loc('l-a01-b2', 'l-a01', 'Bin', 'Bin 2', 'A-01-2', 2),
    loc('l-a02', 'l-cab-a', 'Drawer', 'Drawer 2 — resistors 1 kΩ and up', 'A-02', 2),
    loc('l-a03', 'l-cab-a', 'Drawer', 'Drawer 3 — capacitors', 'A-03', 3),
    loc('l-a04', 'l-cab-a', 'Drawer', 'Drawer 4 — diodes & transistors', 'A-04', 4),
    loc('l-cab-b', 'l-room', 'Cabinet', 'Cabinet B (boards & modules)', 'B', 2),
    loc('l-b01', 'l-cab-b', 'Drawer', 'Drawer 1 — microcontrollers', 'B-01', 1),
    loc('l-b02', 'l-cab-b', 'Drawer', 'Drawer 2 — LEDs & lighting', 'B-02', 2),
    loc('l-b03', 'l-cab-b', 'Drawer', 'Drawer 3 — sensors', 'B-03', 3),
    loc('l-b04', 'l-cab-b', 'Drawer', 'Drawer 4 — motors & power', 'B-04', 4),
    loc('l-shelf', 'l-room', 'Shelf', 'Overflow shelf', 'OVF', 3),
  ]

  let stockN = 0
  const s = (locationId: string, quantity: number | null, status: StockStatus, checkedDaysAgo: number | null, notes = ''): Omit<StockEntry, 'partId'> => ({
    id: `s-${++stockN}`, locationId, quantity, status, notes,
    lastCheckedAt: checkedDaysAgo === null ? null : iso(checkedDaysAgo),
  })

  type Seed = Partial<Omit<Part, 'stock'>> & { name: string; category: string; stock: Array<Omit<StockEntry, 'partId'>> }
  const seeds: Seed[] = [
    { name: 'Resistor', value: '220 Ω', category: 'Resistors', package: '1/4 W through-hole', aliases: ['220R', 'red red brown'], description: 'Carbon film, 5%. Common LED current-limiting resistor.', stock: [s('l-a01-b2', null, 'in_stock', 6), s('l-shelf', null, 'low', 30, 'Bag of leftovers')] },
    { name: 'Resistor', value: '22 Ω', category: 'Resistors', package: '1/4 W through-hole', aliases: ['22R'], stock: [s('l-a01-b1', null, 'in_stock', 6)] },
    { name: 'Resistor', value: '2.2 kΩ', category: 'Resistors', package: '1/4 W through-hole', aliases: ['2k2'], stock: [s('l-a02', null, 'unverified', null)] },
    { name: 'Resistor', value: '4.7 kΩ', category: 'Resistors', package: '1/4 W through-hole', aliases: ['4k7', 'I2C pull-up'], stock: [s('l-a02', null, 'low', 12)] },
    { name: 'Resistor', value: '10 kΩ', category: 'Resistors', package: '1/4 W through-hole', aliases: ['10k', 'pull-up'], stock: [s('l-a02', null, 'in_stock', 12)] },
    { name: 'Electrolytic capacitor', value: '100 µF 25 V', category: 'Capacitors', package: 'Radial', stock: [s('l-a03', 34, 'in_stock', 3)] },
    { name: 'Ceramic capacitor', value: '0.1 µF', category: 'Capacitors', aliases: ['100nF', '104', 'decoupling cap'], stock: [s('l-a03', null, 'in_stock', 3)] },
    { name: 'Signal diode', value: '', partNumber: '1N4148', category: 'Diodes', package: 'DO-35', stock: [s('l-a04', null, 'in_stock', 20)] },
    { name: 'N-channel MOSFET', partNumber: '2N7000', category: 'Transistors', package: 'TO-92', stock: [s('l-a04', 0, 'out', 2)] },
    { name: 'NPN transistor', partNumber: '2N2222A', category: 'Transistors', package: 'TO-92', stock: [s('l-a04', 18, 'in_stock', 20)] },
    { name: '555 timer', partNumber: 'NE555P', manufacturer: 'Texas Instruments', category: 'ICs', package: 'DIP-8', stock: [s('l-a04', 7, 'low', 20)] },
    { name: 'Arduino Nano', partNumber: 'A000005', category: 'Microcontrollers', aliases: ['nano', 'ATmega328P board'], description: 'Breadboard-friendly ATmega328P board, Mini-USB.', stock: [s('l-b01', 6, 'in_stock', 4)] },
    { name: 'Arduino Uno R3', partNumber: 'A000066', category: 'Microcontrollers', aliases: ['uno'], description: 'Starter board for sensor projects and serial control.', stock: [s('l-b01', 2, 'low', 4)] },
    { name: 'ESP32 DevKit', category: 'Wireless', aliases: ['esp32', 'wifi board', 'bluetooth'], description: 'Wi-Fi + Bluetooth microcontroller board.', stock: [s('l-b01', null, 'unverified', null)] },
    { name: 'NeoPixel LED strip', partNumber: 'WS2812B', category: 'LEDs & Lighting', aliases: ['addressable LED', 'RGB strip'], description: '60 LEDs/m, 5 V. Cut to length.', stock: [s('l-b02', null, 'low', 9)] },
    { name: 'NeoPixel ring, 12 LED', partNumber: 'WS2812B-12', category: 'LEDs & Lighting', aliases: ['led ring'], stock: [s('l-b02', 3, 'in_stock', 9)] },
    { name: 'LED, red', value: '5 mm', category: 'LEDs & Lighting', stock: [s('l-b02', null, 'in_stock', 9)] },
    { name: 'Ultrasonic distance sensor', partNumber: 'HC-SR04', category: 'Sensors', stock: [s('l-b03', 9, 'in_stock', 15)] },
    { name: 'Pressure & temperature sensor', partNumber: 'BMP280', category: 'Sensors', aliases: ['barometer'], stock: [s('l-b03', 0, 'out', 15)] },
    { name: 'Micro servo', partNumber: 'SG90', category: 'Motors & Drivers', stock: [s('l-b04', 11, 'in_stock', 5)] },
    { name: 'Dual motor driver', partNumber: 'TB6612FNG', category: 'Motors & Drivers', stock: [s('l-b04', 4, 'in_stock', 5)] },
    { name: 'Buck converter module', value: '5 V', category: 'Power', aliases: ['step-down regulator'], stock: [s('l-b04', null, 'unverified', null)] },
    { name: 'OLED display 0.96"', partNumber: 'SSD1306', category: 'Displays', aliases: ['oled', 'i2c display'], stock: [s('l-shelf', 5, 'in_stock', 30)] },
    { name: 'Tactile push button', value: '6 mm', category: 'Switches & Buttons', aliases: ['pushbutton'], stock: [s('l-shelf', null, 'in_stock', 30)] },
    { name: 'Jumper wire set', category: 'Cables & Wire', aliases: ['dupont', 'breadboard wires'], stock: [s('l-shelf', null, 'low', 30)] },
    { name: 'Audio amplifier board', partNumber: 'PAM8403', category: 'Audio', stock: [s('l-shelf', 2, 'in_stock', 30)] },
  ]

  const parts: Part[] = seeds.map((seed, i) => {
    const id = `p-${i + 1}`
    return {
      id,
      name: seed.name,
      categoryId: cat(seed.category),
      value: seed.value ?? '',
      partNumber: seed.partNumber ?? '',
      manufacturer: seed.manufacturer ?? '',
      package: seed.package ?? '',
      aliases: seed.aliases ?? [],
      description: seed.description ?? '',
      datasheetUrl: '',
      published: true,
      createdAt: iso(60),
      updatedAt: iso(5),
      photos: [],
      stock: seed.stock.map((st) => ({ ...st, partId: id })),
      itemType: 'component',
      reviewStatus: 'verified',
      reviewReasons: [],
      evidence: null,
      verifiedAt: iso(5),
      verifiedByName: null,
      mergedInto: null,
    }
  })

  return { categories, locations, parts }
}

/** Fictional example posts for the demo community page. */
export function makeDemoPosts(): CommunityPost[] {
  return [
    {
      id: 'post-1', kind: 'project', status: 'approved', authorName: 'Demo student', createdAt: iso(3),
      title: 'Desk lamp with a NeoPixel ring',
      body: 'Used the 12-LED NeoPixel ring from drawer B-02 and an Arduino Nano from B-01. Remember a 220 Ω resistor on the data line and a big capacitor across the power.',
    },
    {
      id: 'post-2', kind: 'tip', status: 'approved', authorName: '', createdAt: iso(9),
      title: 'Reading resistor color bands',
      body: '220 Ω is red-red-brown. 4.7 kΩ is yellow-violet-red. If in doubt, a multimeter is faster than squinting.',
    },
    {
      id: 'post-3', kind: 'question', status: 'pending', authorName: 'Demo student', createdAt: iso(0.2),
      title: 'Which motor driver for two small DC motors?',
      body: 'Building a little line-follower. Is the TB6612FNG in B-04 OK for two 6 V hobby motors?',
    },
  ]
}

/** Fictional demo accounts (no real people). */
export function makeDemoUsers(): Member[] {
  return [
    { id: 'u-admin', email: 'demo-admin@bc.edu', displayName: 'Demo Admin', role: 'admin', createdAt: iso(90) },
    { id: 'u-staff', email: 'demo-staff@bc.edu', displayName: 'Demo Staff', role: 'staff', createdAt: iso(60) },
    { id: 'u-student', email: 'demo-student@bc.edu', displayName: 'Demo Student', role: 'member', createdAt: iso(10) },
  ]
}
