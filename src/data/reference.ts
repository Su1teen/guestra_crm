import type { Employee, Organization, Property, PropertyId } from "@/types/crm";

export const organization: Organization = {
  id: "org_les",
  name: "ЛЕС",
  legalName: 'Сеть загородных отелей ЛЕС',
  currency: "KZT",
  propertyIds: ["les_borovoe", "les_astana", "les_alakol"],
};

export const properties: Property[] = [
  {
    id: "les_borovoe",
    name: "ЛЕС Боровое",
    shortName: "Боровое",
    city: "Боровое, Акмолинская область",
    roomTypes: ["Премиум-домик", "Стандартный домик", "Семейный коттедж", "Люкс-шале"],
  },
  {
    id: "les_astana",
    name: "ЛЕС Астана",
    shortName: "Астана",
    city: "Астана",
    roomTypes: ["Делюкс-номер", "Стандартный номер", "Люкс", "Апартаменты"],
  },
  {
    id: "les_alakol",
    name: "ЛЕС Алаколь",
    shortName: "Алаколь",
    city: "Алаколь, Алматинская область",
    roomTypes: ["Пляжный домик", "Стандартный номер"],
  },
];

export const MAIN_PROPERTY_IDS: PropertyId[] = ["les_borovoe", "les_astana"];

export const propertyById = (id: PropertyId) => properties.find((property) => property.id === id) ?? properties[0];

export const propertyName = (id: PropertyId | "all") =>
  id === "all" ? "Все объекты ЛЕС" : propertyById(id).name;

export const nightlyRate: Record<string, number> = {
  "Премиум-домик": 210_000,
  "Стандартный домик": 135_000,
  "Семейный коттедж": 245_000,
  "Люкс-шале": 320_000,
  "Делюкс-номер": 96_000,
  "Стандартный номер": 68_000,
  Люкс: 165_000,
  Апартаменты: 128_000,
  "Пляжный домик": 115_000,
};

export const employees: Employee[] = [
  {
    id: "emp_sultan",
    name: "Султан Аманжолов",
    shortName: "Султан",
    initials: "СА",
    role: "Руководитель отдела продаж",
    email: "sultan@les.kz",
    phone: "+7 701 244 18 90",
    propertyIds: ["les_borovoe", "les_astana", "les_alakol"],
  },
  {
    id: "emp_aigerim",
    name: "Айгерим Смагулова",
    shortName: "Айгерим",
    initials: "АС",
    role: "Старший менеджер по бронированию",
    email: "aigerim@les.kz",
    phone: "+7 701 355 22 41",
    propertyIds: ["les_borovoe"],
  },
  {
    id: "emp_daniyar",
    name: "Данияр Каримов",
    shortName: "Данияр",
    initials: "ДК",
    role: "Менеджер по продажам",
    email: "daniyar@les.kz",
    phone: "+7 702 118 76 03",
    propertyIds: ["les_borovoe", "les_alakol"],
  },
  {
    id: "emp_aliya",
    name: "Алия Нурланова",
    shortName: "Алия",
    initials: "АН",
    role: "Менеджер по бронированию",
    email: "aliya@les.kz",
    phone: "+7 705 902 64 12",
    propertyIds: ["les_astana"],
  },
  {
    id: "emp_timur",
    name: "Тимур Бекешев",
    shortName: "Тимур",
    initials: "ТБ",
    role: "Менеджер корпоративных продаж",
    email: "timur@les.kz",
    phone: "+7 707 441 09 55",
    propertyIds: ["les_astana", "les_borovoe"],
  },
  {
    id: "emp_kamila",
    name: "Камила Досжанова",
    shortName: "Камила",
    initials: "КД",
    role: "Менеджер по продажам",
    email: "kamila@les.kz",
    phone: "+7 708 337 51 27",
    propertyIds: ["les_borovoe", "les_astana"],
  },
  {
    id: "emp_erzhan",
    name: "Ержан Сериков",
    shortName: "Ержан",
    initials: "ЕС",
    role: "Менеджер по продажам",
    email: "erzhan@les.kz",
    phone: "+7 747 810 33 76",
    propertyIds: ["les_astana", "les_alakol"],
  },
  {
    id: "emp_dinara",
    name: "Динара Ахметова",
    shortName: "Динара",
    initials: "ДА",
    role: "Менеджер по работе с гостями",
    email: "dinara@les.kz",
    phone: "+7 771 620 47 88",
    propertyIds: ["les_borovoe", "les_astana"],
  },
];

export const CURRENT_EMPLOYEE_ID = "emp_sultan";

export const employeeById = (id: string) => employees.find((employee) => employee.id === id) ?? employees[0];

export const serviceCatalog = [
  { name: "Завтраки", amount: 30_000 },
  { name: "Трансфер из аэропорта", amount: 40_000 },
  { name: "Поздний выезд", amount: 25_000 },
  { name: "SPA-программа", amount: 85_000 },
  { name: "Ужин в ресторане", amount: 60_000 },
  { name: "Прогулка на лошадях", amount: 45_000 },
  { name: "Баня на дровах", amount: 70_000 },
  { name: "Детская анимация", amount: 20_000 },
];
