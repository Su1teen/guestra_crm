/**
 * Verified accommodation names from the official LES Borovoe accommodation page.
 * Room numbers and counts below are demo inventory labels only; real unit numbers
 * were not published. Forest House rooms are separate sellable units, as on the
 * official page (two double rooms and one six-person room).
 */
export const lesBorovoeUnitTypes = [
  { name: "A-Frame", prefix: "A-", firstNumber: 101, count: 5, capacity: 4, rateCode: "acc_a_frame", demoNightlyRate: 130000 },
  { name: "Nest House", prefix: "N-", firstNumber: 201, count: 5, capacity: 4, rateCode: "acc_nest_house", demoNightlyRate: 210000 },
  { name: "Glass House", prefix: "G-", firstNumber: 301, count: 5, capacity: 4, rateCode: "acc_glass_house", demoNightlyRate: 135000 },
  { name: "Forest House · 2-местный номер", prefix: "F-", firstNumber: 401, count: 2, capacity: 2, rateCode: "acc_forest_double", demoNightlyRate: 135000 },
  { name: "Forest House · 6-местный номер", prefix: "F-", firstNumber: 403, count: 1, capacity: 6, rateCode: "acc_forest_six", demoNightlyRate: 245000 },
] as const;

export const lesBorovoeLegacyCategoryNames = ["Премиум-домик", "Стандартный домик", "Семейный коттедж", "Люкс-шале"] as const;
