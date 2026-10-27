"""Сайт «Инвестиции и уровень жизни в России» на Flask.

Запуск:
    pip install -r requirements.txt
    python app.py
Потом откройте http://localhost:5000

Все тексты и цифры лежат в этом файле. Меняете значения, перезапускаете, страница обновляется.
Чтобы получить один готовый файл для хостинга без Python, выполните: python build_static.py
"""
import calendar
import datetime as dt
import json
import os
import pathlib
from zoneinfo import ZoneInfo

try:
    from flask import Flask, Response, render_template, request, send_from_directory
except ModuleNotFoundError:
    raise SystemExit("\nНе установлен Flask. Выполните в этой папке:\n    python -m pip install -r requirements.txt\nи запустите снова (или используйте start.bat / start.command).\n")

import blog
import live_data
import glossary
import security

app = Flask(__name__)
app.config.update(MAX_CONTENT_LENGTH=16 * 1024, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
BASE = pathlib.Path(__file__).parent

# ======================================================================
# 1. О команде: замените заглушки своими текстами
# ======================================================================
TEAM = {
    "name": "Growth Syndicate",
    "signer": "Даниил",
    "email": "teamgrowth37@gmail.com",
    "phone": "",
    "year": 2026,
    "services": [
        ("Аналитика по России", "Разбираем ключевую ставку, инфляцию, зарплаты и рынок недвижимости и объясняем, что они значат для денег и планов."),
        ("Инвестиционные расчёты и стратегия", "Считаем вклады, ипотеку и накопления на разные сроки, сравниваем варианты вложений и помогаем выбрать подход под цель и допустимый риск."),
        ("Финансовая грамотность", "Рассказываем простым языком, как защитить деньги от инфляции, не переплатить по кредиту и планировать бюджет на годы вперёд."),
    ],
    "advantages": [
        ("Только проверенные данные", "Ключевая ставка, курсы и индексы берутся у Банка России и Московской биржи и обновляются автоматически, остальные показатели у Росстата. Источник указан рядом с каждой цифрой."),
        ("Понятный язык вместо терминов", "Объясняем, что ставка, инфляция и зарплаты значат для вашего кошелька: на примерах и в рублях, без сложного жаргона."),
        ("Расчёты под вашу ситуацию", "Калькуляторы вклада, ипотеки, инфляции и инвестиций работают по актуальным ставкам, а итог можно сохранить в PDF и показать семье или партнёру."),
        ("Честно о рисках", "Показываем не только доход, но и инфляцию, переплату по кредиту и реальную доходность. Мы не обещаем гарантированной прибыли и не даём индивидуальных инвестиционных рекомендаций."),
        ("Индивидуальный подход", "Разбираем цели, сроки и допустимый риск каждого клиента и подбираем решение под них, а не продаём одну схему всем."),
    ],
}

# ======================================================================
# 2. Текущие показатели по России (на 21 октября 2026)
# ======================================================================
UPDATED = "21.10.2026"   # дата, когда вы последний раз вручную обновляли показатели ниже

# Даты заседаний Банка России по ключевой ставке на 2026 год (календарь ЦБ: cbr.ru/dkp/cal_mp/).
# По ним показывается «ближайшее заседание» и календарь решений. Даты следующего года добавьте, когда ЦБ их опубликует.
MEETINGS = [dt.date(2026, 2, 13), dt.date(2026, 3, 20), dt.date(2026, 4, 24), dt.date(2026, 6, 19),
            dt.date(2026, 7, 24), dt.date(2026, 9, 11), dt.date(2026, 10, 23), dt.date(2026, 12, 18)]
# Решения по прошедшим заседаниям: дата -> (ставка до, ставка после), %. Новое решение добавляйте сюда.
MEETING_DECISIONS = {
    "2026-02-13": (16.0, 15.5), "2026-03-20": (15.5, 15.0), "2026-04-24": (15.0, 14.5),
    "2026-06-19": (14.5, 14.25), "2026-07-24": (14.25, 14.0), "2026-09-11": (14.0, 14.0),
    "2026-10-23": (14.0, 14.0),
}
WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]

# Последнее решение Банка России, текст вручную (источник: сообщение ЦБ от 23.10.2026).
LAST_DECISION = ("23 октября Банк России сохранил ключевую ставку на уровне 14%. В базовом прогнозе "
                 "средняя ставка в 2027 году составит 12,5–13,5%, а годовая инфляция вернётся к 4%.")

KEY_RATE = 14.0          # ключевая ставка, % (с 24 июля 2026)
INFLATION = 6.35         # годовая инфляция, сентябрь 2026, %
AVG_WAGE = 109_524       # средняя начисленная зарплата, июль 2026, ₽
AVG_WAGE_APR = 109_052   # то же за апрель 2026, для сравнения регионов (данные региональной таблицы за апрель)

GLANCE = [
    ("Ключевая ставка", "14%"),
    ("Инфляция за год", "6,35%"),
    ("Безработица", "2,3%"),
    ("Доллар (ЦБ)", "82,85 ₽"),
    ("Индекс МосБиржи", "2 426"),
]

PEOPLE = [
    {"k": "Средняя начисленная зарплата, июль", "v": "109 524", "unit": "₽", "tone": "",
     "n": "К июлю 2025 года +9,5%. В июне было 114 743 ₽, реальные зарплаты выросли на 3,4%."},
    {"k": "Безработица, июль", "v": "2,3", "unit": "%", "tone": "",
     "n": "Минимум за всю историю наблюдений был в мае, 2,1%. Власти оценивают нехватку работников в 3,1 млн человек к 2030 году."},
    {"k": "Доля населения ниже границы бедности, II кв.", "v": "7,0", "unit": "%", "tone": "",
     "n": "Граница бедности 17 816 ₽ в месяц. Год назад доля была на 0,4 п. п. выше."},
    {"k": "Инфляция за 12 месяцев, сентябрь", "v": "6,35", "unit": "%", "tone": "",
     "n": "Минэкономразвития ждёт 6,8% по итогам 2026 года и возврата к цели в 4% к концу 2027 года."},
]

INVEST = [
    {"k": "Инвестиции в основной капитал, I полугодие", "v": "−9,9", "unit": "%", "tone": "neg",
     "n": "К прошлому году: −14,3% в первом квартале и −6,6% во втором. Минэкономразвития ждёт −5,4% за весь 2026 год."},
    {"k": "Рост ВВП в 2026 году, прогнозы", "v": "0,5–1,1", "unit": "%", "tone": "",
     "n": "Опрос экономистов Банка России даёт 0,5%, Минэкономразвития 0,6%, МВФ 1,1%."},
    {"k": "Индекс МосБиржи, 16 октября", "v": "2 426", "unit": "", "tone": "",
     "n": "На 6,4% выше, чем 1 октября (2 280 пунктов). Индекс РТС закрылся на 914."},
    {"k": "Доллар по курсу ЦБ, 20 октября", "v": "82,85", "unit": "₽", "tone": "",
     "n": "Юань 12,39 ₽, евро 93,23 ₽. В мае доллар стоил около 71 ₽."},
]

BARS = [
    {"label": "Рыночная ипотека, новостройки", "value": 21.28, "alt": True},
    {"label": "Ключевая ставка", "value": 14.00, "alt": False},
    {"label": "Вклады, максимальные ставки", "value": 13.06, "alt": False},
    {"label": "Инфляция за год", "value": 6.35, "alt": True},
]
BAR_MAX = 25
AXIS = [0, 5, 10, 15, 20, 25]

# ======================================================================
# 3. Динамика (графики)
# ======================================================================
# Ключевая ставка на конец месяца и годовая инфляция (г/г). Источники: Банк России, Росстат, СберCIB.
# Год и месяц для каждой точки графика. Добавляя месяц в MONTHS_RATE, добавляйте его и сюда,
# а также значения в KEY_SERIES (запасное) и INFL_SERIES.
RATE_YM = [(2025, 12), (2026, 1), (2026, 2), (2026, 3), (2026, 4), (2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9)]
MONTHS_RATE = [
    ("Дек", "декабрь 2025"), ("Янв", "январь 2026"), ("Фев", "февраль 2026"),
    ("Мар", "март 2026"), ("Апр", "апрель 2026"), ("Май", "май 2026"),
    ("Июн", "июнь 2026"), ("Июл", "июль 2026"), ("Авг", "август 2026"), ("Сен", "сентябрь 2026"),
]
# Налоги и вычеты (правила на 2026 год; проверьте после изменений в Налоговом кодексе)
TAX = {
    "free_base": 1_000_000,       # необлагаемая база для процентов по вкладам, ₽
    "free_rate": 16.0,            # наибольшая ключевая ставка на 1-е число месяцев 2026 года, %
    "brackets": [(2_400_000, 13), (5_000_000, 15), (20_000_000, 18), (50_000_000, 20), (None, 22)],
    "deposit_threshold": 2_400_000,   # проценты свыше этой суммы за год облагаются по 15%
    "home_limit": 2_000_000, "interest_limit": 3_000_000, "iis_limit": 400_000, "rate": 13,
}
# Сценарии: на сколько процентных пунктов сдвигаются значения относительно базового.
# dep: ставки по вкладам и доходность накоплений; bond/stock: облигации и акции; infl: инфляция;
# loan: ставки по кредитам; house: рост цен на жильё; rent: рост аренды.
SCENARIOS = {
    "pess": {"label": "Пессимистичный", "hint": "доходы ниже, расходы выше",
             "desc": "Неблагоприятный для вас: вклады и инвестиции приносят меньше, инфляция и ставки по кредитам выше, жильё дорожает медленнее, аренда быстрее.",
             "shift": {"dep": -4, "bond": -3, "stock": -8, "infl": 3, "loan": 3, "house": -3, "rent": 3}},
    "base": {"label": "Базовый", "hint": "значения сегодня",
             "desc": "Значения сайта на сегодня: актуальные ставки и инфляция.",
             "shift": {"dep": 0, "bond": 0, "stock": 0, "infl": 0, "loan": 0, "house": 0, "rent": 0}},
    "opt": {"label": "Оптимистичный", "hint": "доходы выше, расходы ниже",
            "desc": "Благоприятный для вас: вклады и инвестиции приносят больше, инфляция и ставки по кредитам ниже, жильё дорожает быстрее, аренда медленнее.",
            "shift": {"dep": 2, "bond": 1, "stock": 5, "infl": -2, "loan": -3, "house": 2, "rent": -2}},
}
SCENARIO_NOTES = {"dep": "Вклады и накопления", "bond": "Облигации", "stock": "Акции", "infl": "Инфляция",
                  "loan": "Ставки по кредитам и ипотеке", "house": "Рост цен на жильё", "rent": "Рост аренды"}

# Запасные курсы ЦБ, если автообновление недоступно (20 октября 2026)
FX_FALLBACK = {"date": "2026-10-20", "USD": 82.85, "EUR": 93.23, "CNY": 12.39}

BOND_RATE = 14.0      # примерная доходность облигаций для калькулятора сравнения, %
STOCK_RATE = 16.0     # примерная ожидаемая доходность акций для калькулятора сравнения, %

KEY_SERIES = [16.0, 16.0, 15.5, 15.0, 14.5, 14.5, 14.25, 14.0, 14.0, 14.0]
INFL_SERIES = [5.59, 6.0, 5.91, 5.86, 5.58, 5.31, 6.02, 5.98, 6.33, 6.35]

# Средняя начисленная зарплата, тыс. ₽. None: значение не найдено в источниках.
MONTHS_WAGE = [
    ("Окт", "октябрь 2025"), ("Ноя", "ноябрь 2025"), ("Дек", "декабрь 2025"),
    ("Янв", "январь 2026"), ("Фев", "февраль 2026"), ("Мар", "март 2026"),
    ("Апр", "апрель 2026"), ("Май", "май 2026"), ("Июн", "июнь 2026"), ("Июл", "июль 2026"),
]
WAGE_SERIES = [99.707, 98.192, 139.727, None, None, None, 109.052, 110.216, 114.743, 109.524]

# ======================================================================
# 4. Регионы
# ======================================================================
# wage: средняя начисленная зарплата за апрель 2026, ₽
# unemp: безработица, среднее за май–июль 2026, %
# infl: годовая инфляция в сентябре 2026, %
# None: показателя нет в использованных источниках, на странице будет прочерк
REGIONS = [
    {"name": "Москва", "wage": 196_825, "unemp": 1.1, "infl": None},
    {"name": "Московская область", "wage": 130_556, "unemp": 1.9, "infl": None},
    {"name": "Санкт-Петербург", "wage": 128_509, "unemp": 1.5, "infl": 6.03},
    {"name": "Татарстан", "wage": 98_316, "unemp": 1.7, "infl": None},
    {"name": "Свердловская область", "wage": 94_807, "unemp": None, "infl": None},
    {"name": "Новосибирская область", "wage": 92_457, "unemp": None, "infl": None},
    {"name": "Краснодарский край", "wage": 85_171, "unemp": None, "infl": None},
    {"name": "Башкортостан", "wage": None, "unemp": 1.4, "infl": 5.18},
]
RUSSIA_ROW = {"name": "Россия в целом", "wage": AVG_WAGE_APR, "unemp": 2.2, "infl": 6.35}

# Для справки под таблицей
REGION_NOTES = [
    "Самые высокие зарплаты в мае 2026: Чукотка 260 700 ₽, Магаданская область 214 400 ₽, Ямало-Ненецкий округ 205 300 ₽.",
    "Инфляция по регионам различается более чем вдвое: в сентябре годовая была 13,26% в Крыму и 12,03% в Туве, а в Карелии 5,21% и в Башкортостане 5,18%.",
]

# ======================================================================
# 5. Калькуляторы
# ======================================================================
# Средние максимальные ставки по рублёвым вкладам в крупнейших банках, октябрь 2026 (Банк России).
DEPOSIT_RATES = [
    {"upto_months": 3, "rate": 12.55, "label": "до 90 дней"},
    {"upto_months": 6, "rate": 12.87, "label": "91–180 дней"},
    {"upto_months": 12, "rate": 12.73, "label": "181 день – 1 год"},
    {"upto_months": 999, "rate": 11.75, "label": "свыше 1 года"},
]

# Рыночная ипотека: средняя полная стоимость кредита (ПСК), октябрь 2026; льготная ставка до 6%.
MORTGAGE_PRESETS = [
    {"label": "Рынок, новостройки (ПСК 21,28%)", "rate": 21.28},
    {"label": "Рынок, вторичное жильё (ПСК 21,83%)", "rate": 21.83},
    {"label": "Льготная ипотека (до 6%)", "rate": 6.0},
]


MORTGAGE_FACTS = [
    "Рыночная ипотека остаётся дорогой: средняя полная стоимость кредита около 21,3% на новостройки и 21,8% на вторичное жильё (середина октября 2026).",
    "Минимальные предложения банков на рынке начинаются примерно с 15,9–16,99% годовых, но такие ставки доступны не всем заёмщикам.",
    "Льготные программы (IT-ипотека, дальневосточная, сельская) дают ставку в пределах 6%.",
    "С 1 октября 2026 года семейная ипотека работает по новым правилам: ставка и лимит зависят от числа детей.",
    "Банки снижают ипотечные ставки медленнее, чем Банк России ключевую, и с момента последнего заседания ставки по кредитам почти не менялись.",
]


def deposit_income(amount, months, rate, capitalize=False):
    """Доход по вкладу до налогов. Без капитализации проценты простые."""
    if capitalize:
        final = amount * (1 + rate / 100 / 12) ** months
    else:
        final = amount * (1 + rate / 100 * months / 12)
    return final - amount


def real_gain(amount, months, rate, inflation=INFLATION):
    """Доход по вкладу в сегодняшних рублях, с учётом инфляции."""
    final = amount + deposit_income(amount, months, rate)
    return final / (1 + inflation / 100) ** (months / 12) - amount


def annuity_payment(loan, years, rate):
    """Аннуитетный платёж в месяц."""
    n = years * 12
    i = rate / 100 / 12
    if i == 0:
        return loan / n
    return loan * i / (1 - (1 + i) ** -n)


def rub(x):
    return f"{round(x):,}".replace(",", " ") + " ₽"


# ======================================================================
# 6. Что это значит для вас
# ======================================================================
def build_scenarios(key_rate=KEY_RATE, next_meeting=None):
    dep = 1_000_000
    dep_rate = 12.73
    inc = deposit_income(dep, 12, dep_rate)
    real = real_gain(dep, 12, dep_rate)

    loan = 6_000_000 * 0.8
    pay_mkt = annuity_payment(loan, 20, 21.28)
    pay_pref = annuity_payment(loan, 20, 6.0)
    share = pay_mkt / AVG_WAGE * 100

    return [
        {
            "title": "Если у вас есть накопления",
            "lead": (f"Вклады сейчас дают до 13,06% годовых при инфляции {str(INFLATION).replace('.', ',')}%. "
                     f"Пример: {rub(dep)} на год под {str(dep_rate).replace('.', ',')}% приносят около {rub(inc)} "
                     f"до налогов, а в сегодняшних рублях около {rub(real)}."),
            "points": [
                "Ставки по вкладам зависят от решений Банка России." + (f" Ближайшее заседание: {next_meeting}." if next_meeting else ""),
                "Максимальные ставки часто действуют только на ограниченный срок или при условиях.",
                "Доход считается до налогов. Проверьте налог на проценты по вкладам для вашей суммы.",
            ],
            "link": ("#kalkulyatory", "Посчитать вклад"),
        },
        {
            "title": "Если вы берёте ипотеку",
            "lead": (f"Рыночная ипотека стоит около 21% ПСК, льготные программы до 6%. На квартиру за 6 млн ₽ "
                     f"с взносом 20% на 20 лет платёж составит около {rub(pay_mkt)} в месяц на рынке "
                     f"и около {rub(pay_pref)} по ставке 6%."),
            "points": [
                f"Рыночный платёж в этом примере равен примерно {round(share)}% средней зарплаты по России.",
                "С 1 октября 2026 года ставка и лимит семейной ипотеки зависят от числа детей.",
                "Банки снижают ипотечные ставки медленнее, чем Банк России ключевую.",
            ],
            "link": ("#kalkulyatory", "Посчитать ипотеку"),
        },
        {
            "title": "Если у вас бизнес",
            "lead": (f"Кредиты остаются дорогими: ключевая ставка {fmt_num(key_rate)}%, а средняя рентабельность бизнеса в России, "
                     "по оценкам экспертов, не выше 10–12%. Инвестиции в основной капитал за полугодие упали на 9,9%."),
            "points": [
                "Безработица 2,3% и нехватка работников: зарплаты растут быстрее цен, издержки на персонал увеличиваются.",
                "Спрос поддерживают доходы населения, а не инвестиции: реальные зарплаты в июне выросли на 3,4%.",
                "Власти ждут возобновления роста инвестиций в 2027 году, прогнозы расходятся.",
            ],
            "link": ("#dinamika", "Смотреть динамику"),
        },
        {
            "title": "Если вы работаете по найму",
            "lead": ("Номинальная зарплата в июле выросла на 9,5% за год при инфляции около 6,4%, "
                     "поэтому покупательная способность растёт. Безработица около 2,2–2,3%."),
            "points": [
                "Средняя зарплата по стране не показывает типичную: сильно влияют высокие доходы.",
                "Различия между регионами большие: в Москве зарплата почти вдвое выше средней по России.",
                "Власти прогнозируют рост реальных доходов на 3–5% в год до 2030 года.",
            ],
            "link": ("#regiony", "Сравнить регионы"),
        },
    ]


SOURCES = [
    ("Ипотека в октябре 2026: ставки и прогнозы", "https://www.sravni.ru/text/kogda-luchshe-brat-ipoteku-v-oktyabre-2026-goda/"),
    ("Решение Банка России 23 октября", "https://finance.mail.ru/article/bank-rossii-ostavil-klyuchevuyu-stavku-na-otmetke-14-69233890/"),
    ("Банк России: инфляция в сентябре", "https://www.cbr.ru/press/reginfl/?id=70297"),
    ("Банк России: инфляция в Санкт-Петербурге", "https://cbr.ru/press/reginfl/?id=70242"),
    ("Банк России: инфляция в Башкортостане", "https://www.cbr.ru/press/reginfl/?id=70237"),
    ("Ключевая ставка: история решений", "https://brobank.ru/klyuchevaya-stavka-cb-rf/"),
    ("Решение по ключевой ставке, 11 сентября", "https://ru.themoscowtimes.com/2026/09/11/tekst-soobschenie-tsbr-o-klyuchevoy-stavke-a205851"),
    ("Инфляция по месяцам 2026", "https://sbercib.ru/publication/inflyatsiya-v-rossii-v-2026-godu-dinamika-i-prognozi"),
    ("Реальные зарплаты, июнь", "https://ru.themoscowtimes.com/2026/09/02/rost-realnykh-zarplat-v-rf-v-iyune-26g-zamedlilsya-do-34-gg-a205127"),
    ("Средняя зарплата, июль", "https://www.amic.ru/news/srednyaya-zarplata-v-rossii-vyrosla-do-110-tysyach-rubley-593552"),
    ("Средняя зарплата, декабрь 2025", "https://expert.ru/news/srednyaya-zarplata-v-rossii-v-dekabre-povysilas-na-40-tysyach-rubley"),
    ("Зарплаты по регионам, апрель 2026", "https://finance.mail.ru/article/srednyaya-zarplata-v-rossii-432/"),
    ("Зарплаты в регионах-лидерах, май", "https://abnews.ru/news/2026/8/4/gde-v-rossii-poluchayut-bolshe-200-tysyach-rosstat-nazval-tri-regiona"),
    ("Безработица по регионам, май–июль", "https://finance.mail.ru/article/analitiki-raskryli-v-kakih-regionah-rf-pobedili-bezraboticu-69228580/"),
    ("Безработица, июль", "https://www.finmarket.ru/news/6698655"),
    ("Уровень бедности, II квартал", "https://fomag.ru/news-streem/uroven-bednosti-vo-ii-kvartale-2026-goda-v-rf-sostavil-7-0-rosstat/"),
    ("Инвестиции в основной капитал, II квартал", "https://ru.themoscowtimes.com/2026/09/02/investitsii-v-rf-vo-2-kv-26g-prodolzhili-padenie-za-polugodie-upali-pochti-na-10-a205129"),
    ("Прогноз Минэкономразвития по инвестициям", "https://kurs.com.ua/ru/novost/1481356-rosija-pogirshila-prognoz-promislovosti-ta-ochikue-padinnja-investicii"),
    ("Прогноз роста ВВП, опрос экономистов", "https://www.tks.ru/politics/2026/09/03/0008/ekonomistyi-ozhidayut-rost-vvp-rossii-vsego-na-0-5-procent-v-2026-godu/"),
    ("Московская биржа: индексы 16 октября", "https://www.moex.com/n105203?nt=108"),
    ("Курсы ЦБ на 20 октября", "https://investfuture.ru/articles/obzor-valyut-2026-10-20"),
    ("Ставки по вкладам, октябрь", "https://investfuture.ru/articles/bank-rossii-nazval-maksimalnuyu-stavku-po-rublevym-vkladam-13-06-8eb248a33aa0bca8"),
    ("Стоимость ипотеки, октябрь", "https://brobank.ru/stoimost-ipoteki-oktyabr-2026-goda/"),
]


def fmt(x: float) -> str:
    """21.28 -> '21,28' (запятая как десятичный разделитель)."""
    return f"{x:.2f}".replace(".", ",")


def fmt_num(x: float) -> str:
    """14.0 -> '14', 14.25 -> '14,25'."""
    return f"{x:g}".replace(".", ",")


def fmt_int(x: float) -> str:
    return f"{round(x):,}".replace(",", "\u00a0")


MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня",
              "июля", "августа", "сентября", "октября", "ноября", "декабря"]
MSK = ZoneInfo("Europe/Moscow")


def date_ru(d: dt.date) -> str:
    return f"{d.day} {MONTHS_GEN[d.month - 1]}"


def next_meeting(today: dt.date):
    future = [m for m in MEETINGS if m > today]
    return date_ru(min(future)) if future else None


def build_faq(key_rate: float, next_meeting: str | None):
    real_dep = (1 + 12.73 / 100) / (1 + INFLATION / 100) - 1
    meet = f" Ближайшее заседание: {next_meeting}." if next_meeting else ""
    return [
        ("Что такое ключевая ставка и почему о ней столько говорят?",
         f"Это ставка, по которой Банк России кредитует банки. От неё зависят проценты по вкладам и кредитам. "
         f"Сейчас она {fmt_num(key_rate)}%. Банк России пересматривает её на плановых заседаниях.{meet}"),
        ("Почему вклады дают больше инфляции, а ипотека всё равно дорогая?",
         f"Банки привлекают деньги по ставкам около ключевой: максимальные ставки по вкладам в крупнейших банках сейчас "
         f"около 13,06% при инфляции {fmt(INFLATION)}%. Кредиты стоят дороже, потому что банк закладывает в ставку свою маржу "
         f"и риски: рыночная ипотека обходится примерно в 21% полной стоимости кредита. По льготным программам ставка "
         f"до 6%, разницу банкам компенсирует государство."),
        ("Что такое реальная доходность вклада?",
         f"Это доходность с поправкой на рост цен. Вклад под 12,73% годовых при инфляции {fmt(INFLATION)}% приносит в "
         f"пересчёте на покупательную способность около {fmt(real_dep * 100)}% в год, до налогов."),
        ("Что показывает средняя зарплата и почему она выше, чем у большинства?",
         f"Росстат делит фонд начисленной зарплаты на число работников, поэтому в среднее попадают и очень высокие доходы. "
         f"Типичная зарплата ниже. Сейчас средняя по России {fmt_int(AVG_WAGE)} ₽ в месяц (июль 2026), в Москве она "
         f"почти вдвое выше средней по стране."),
        ("Что такое ПСК и чем она отличается от ставки в договоре?",
         "Полная стоимость кредита включает не только проценты, но и обязательные платежи по договору, поэтому обычно "
         "выше номинальной ставки. В калькуляторе ипотеки рыночные ставки показаны как ПСК. Реальный платёж в вашем банке "
         "может отличаться, уточняйте его в банке."),
        ("Как часто обновляются цифры на сайте?",
         "Курсы валют, ключевая ставка и индексы биржи подтягиваются автоматически из данных Банка России и Московской "
         "биржи. Инфляция, зарплаты, безработица, бедность, инвестиции и данные по регионам обновляются вручную после "
         "публикаций Росстата. Дата последнего ручного обновления указана над карточками с данными."),
        ("Это инвестиционная рекомендация?",
         "Нет. Страница содержит справочную информацию и расчёты по открытым данным. Решения о вложениях принимайте с "
         "учётом своих целей, срока и готовности к риску, при необходимости обратитесь к лицензированному консультанту."),
    ]


def region_rows():
    rows = []
    for r in REGIONS:
        row = dict(r)
        row["ratio"] = round(r["wage"] / AVG_WAGE_APR, 2) if r["wage"] else None
        rows.append(row)
    rows.sort(key=lambda r: (r["wage"] is None, -(r["wage"] or 0)))
    return rows


def moved(a: float, b: float, up: str, down: str) -> str:
    if abs(a - b) < 1e-9:
        return "не изменилась"
    return up if b > a else down


def build_quiz(key: float, infl: float) -> list[dict]:
    """Вопросы мини-квиза. В каждом: q, options, correct (номер верного ответа с нуля), why (пояснение), link."""
    free = fmt_int(TAX["free_base"] * TAX["free_rate"] / 100)
    key_opts = sorted({round(key + d, 2) for d in (-3, -1.5, 0, 2.5)})
    questions = [
        {"q": "Что такое ключевая ставка Банка России?",
         "options": ["Налог на доходы по вкладам",
                     "Ставка, по которой Банк России кредитует банки; от неё зависят ставки по вкладам и кредитам",
                     "Курс доллара, который устанавливает регулятор",
                     "Максимальный процент, который банк может взять по ипотеке"],
         "correct": 1,
         "why": "Это базовая цена денег в экономике. Банки ориентируются на неё, когда устанавливают ставки по вкладам и кредитам.",
         "link": ["#dannye", "Данные по ставке"]},
        {"q": "Ключевая ставка снижается. Что обычно происходит со ставками по новым вкладам?",
         "options": ["Растут", "Снижаются, с задержкой в несколько недель", "Не меняются", "Меняются только по валютным вкладам"],
         "correct": 1,
         "why": "Банки привязывают вклады к ключевой ставке, но подстраиваются не сразу. Уже открытый вклад с фиксированной ставкой не меняется.",
         "link": ["razbory/snizhenie-stavki-i-vklad/", "Разбор про снижение ставки"]},
        {"q": "Какая сейчас ключевая ставка Банка России?",
         "options": [f"{fmt_num(k)}%" for k in key_opts],
         "correct": key_opts.index(round(key, 2)),
         "why": f"Сейчас ключевая ставка {fmt_num(key)}%. Значение на сайте обновляется автоматически.",
         "link": ["#dinamika", "График ставки"]},
        {"q": "Вклад приносит 12% в год, инфляция составляет 8%. Какова примерная реальная доходность?",
         "options": ["Около 20%", "Около 12%", "Около 4%", "Около 8%"],
         "correct": 2,
         "why": "Реальная доходность примерно равна ставке минус инфляция: 12 − 8 = 4%. Точнее считают так: (1 + 0,12) ÷ (1 + 0,08) − 1 ≈ 3,7%.",
         "link": ["#kalkulyatory", "Калькулятор инфляции"]},
        {"q": f"Миллион рублей лежит без вложений, а инфляция {fmt_num(infl)}% в год. Что будет с его покупательной способностью за 5 лет?",
         "options": ["Не изменится", f"Уменьшится примерно до {fmt_int(1_000_000 / (1 + infl / 100) ** 5)} ₽ в сегодняшних ценах",
                     "Вырастет, потому что цены растут", "Уменьшится ровно на 5%"],
         "correct": 1,
         "why": f"Деньги теряют ценность по сложной формуле: 1 000 000 ÷ (1 + {fmt_num(infl / 100)})⁵ ≈ {fmt_int(1_000_000 / (1 + infl / 100) ** 5)} ₽.",
         "link": ["#kalkulyatory", "Посчитать самому"]},
        {"q": "Какая часть процентов по вкладам в 2026 году не облагается налогом?",
         "options": ["Никакая, налог платят со всего дохода",
                     f"1 млн ₽ × наибольшая ключевая ставка на 1-е число месяцев года, сейчас это {free} ₽",
                     "Все проценты до 1 млн ₽ в год", "Проценты по вкладам до 1,4 млн ₽"],
         "correct": 1,
         "why": f"Необлагаемая сумма считается как 1 млн ₽ × максимальная ключевая ставка на 1-е число месяцев года. Для 2026 года это {free} ₽, с остатка платят 13% (до 2,4 млн ₽ дохода, дальше 15%).",
         "link": ["razbory/nalog-na-vklady-2026/", "Разбор про налог на вклады"]},
        {"q": "До какой суммы вклады в одном банке застрахованы государством?",
         "options": ["До 700 тысяч рублей", "До 3 миллионов рублей", "До 1,4 миллиона рублей", "Без ограничений"],
         "correct": 2,
         "why": "Страховое возмещение по вкладам в одном банке составляет до 1,4 млн ₽ (вместе с процентами). Деньги сверх этой суммы лучше разделить между банками.",
         "link": ["#instrumenty", "Налоги и вычеты"]},
    ]
    # верный ответ не должен всегда стоять на одном месте: переносим его на заранее заданную позицию
    for item, target in zip(questions, [2, 0, None, 1, 3, 3, 0]):
        if target is not None and target < len(item["options"]):
            opts = item["options"]
            right = opts.pop(item["correct"])
            opts.insert(target, right)
            item["correct"] = target
    return questions


def live_view(now: dt.datetime | None = None) -> dict:
    """Собирает всё, что зависит от автоматически получаемых данных, с запасными значениями."""
    now = now or dt.datetime.now(MSK)
    live = live_data.get_live()
    status = live.get("status", {})

    key = live.get("key_rate", KEY_RATE)
    key_since = None
    if live.get("key_since"):
        key_since = date_ru(dt.date.fromisoformat(live["key_since"]))

    # помесячный ряд ставки для графика: на конец каждого месяца
    key_series = list(KEY_SERIES)
    hist = [tuple(r) for r in live.get("key_history", [])]
    if hist:
        for idx, (y, m) in enumerate(RATE_YM):
            last_day = min(dt.date(y, m, calendar.monthrange(y, m)[1]), now.date())
            v = live_data.rate_on(hist, last_day)
            if v is not None:
                key_series[idx] = v

    glance = list(GLANCE)
    invest = [dict(c) for c in INVEST]
    bars = [dict(b) for b in BARS]

    glance[0] = ("Ключевая ставка", f"{fmt_num(key)}%")
    for b in bars:
        if b["label"] == "Ключевая ставка":
            b["value"] = key

    rates = live.get("rates")
    if rates:
        glance[3] = ("Доллар (ЦБ)", f"{fmt(rates['USD'])}\u00a0₽")
        d = dt.date.fromisoformat(rates["date"])
        invest[3] = {"k": f"Доллар по курсу ЦБ на {date_ru(d)}", "v": fmt(rates["USD"]), "unit": "₽", "tone": "",
                     "n": f"Юань {fmt(rates['CNY'])} ₽, евро {fmt(rates['EUR'])} ₽."}

    imoex = live.get("imoex")
    if imoex:
        glance[4] = ("Индекс МосБиржи", fmt_int(imoex["value"]))
        chg = imoex.get("change_pct")
        parts = []
        if chg is not None:
            sign = "+" if chg > 0 else ("−" if chg < 0 else "")
            parts.append(f"К предыдущему закрытию {sign}{fmt(abs(chg))}%.")
        rtsi = live.get("rtsi")
        if rtsi:
            parts.append(f"Индекс РТС {fmt_int(rtsi['value'])}.")
        invest[2] = {"k": "Индекс МосБиржи", "v": fmt_int(imoex["value"]), "unit": "", "tone": "",
                     "n": " ".join(parts) or "Значение на момент последнего обновления."}

    # пометка об автообновлении
    sources_ok = [n for n in live_data.SOURCES if status.get(n, {}).get("ok")]
    failed = [live_data.SOURCES[n][0] for n in live_data.SOURCES if n in status and not status[n]["ok"]]
    stamp = live.get("checked_at")
    if sources_ok and stamp:
        t = dt.datetime.fromisoformat(stamp).astimezone(MSK).strftime("%d.%m.%Y %H:%M")
        live_note = f"Курсы валют, ключевая ставка и индексы биржи обновляются автоматически, последняя проверка {t} МСК."
        if failed:
            live_note += f" Не удалось обновить: {', '.join(failed).lower()}, показаны последние известные значения."
        asof = now.strftime("%d.%m.%Y")
    elif failed:
        live_note = "Автообновление курсов, ставки и индексов сейчас недоступно, показаны значения на " + UPDATED + "."
        asof = UPDATED
    else:
        live_note = "Курсы валют, ключевая ставка и индексы биржи обновляются автоматически."
        asof = UPDATED

    nm = next_meeting(now.date())
    scale_sub = (f"Ключевая ставка {fmt_num(key)}% действует с {key_since}." if key_since
                 else f"Текущая ключевая ставка {fmt_num(key)}%.") + (
        f" Следующее заседание Банка России назначено на {nm}." if nm else "")

    first_month = MONTHS_GEN[RATE_YM[0][1] - 1]
    dyn_lead = (
        f"С {first_month} ключевая ставка {moved(key_series[0], key, 'выросла', 'снизилась')} "
        f"с {fmt_num(key_series[0])}% до {fmt_num(key)}%, а инфляция за 12 месяцев "
        f"{moved(INFL_SERIES[0], INFL_SERIES[-1], 'выросла', 'снизилась')} "
        f"с {fmt_num(round(INFL_SERIES[0], 1))}% до {fmt_num(INFL_SERIES[-1])}%. "
        f"Разрыв между ними сейчас {fmt(key - INFLATION)} п. п."
    )

    return {"key": key, "key_series": key_series, "glance": glance, "invest": invest, "bars": bars,
            "live_note": live_note, "asof": asof, "scale_sub": scale_sub, "dyn_lead": dyn_lead, "next_meeting": nm}


@app.route("/")
def index():
    v = live_view()
    bars = [
        {**b, "width": round(b["value"] / BAR_MAX * 100, 1), "text": fmt(b["value"])}
        for b in v["bars"]
    ]
    # Данные для скриптов страницы (графики и калькуляторы)
    site_data = {
        "keyRate": v["key"],
        "inflation": INFLATION,
        "avgWage": AVG_WAGE,
        "quiz": build_quiz(v["key"], INFLATION),
        "rate": {
            "labels": [m[0] for m in MONTHS_RATE],
            "full": [m[1] for m in MONTHS_RATE],
            "key": v["key_series"],
            "infl": INFL_SERIES,
        },
        "wage": {
            "labels": [m[0] for m in MONTHS_WAGE],
            "full": [m[1] for m in MONTHS_WAGE],
            "values": WAGE_SERIES,
        },
        "depositRates": DEPOSIT_RATES,
        "mortgagePresets": MORTGAGE_PRESETS,
        "asOf": v["asof"],
        "team": TEAM["name"],
        "tax": TAX,
        "scenarios": SCENARIOS, "scenarioNotes": SCENARIO_NOTES,
        "fx": fx_view(),
        "meetings": [m.isoformat() for m in MEETINGS],
    }
    faq = build_faq(v["key"], v["next_meeting"])
    dep_year = next(r["rate"] for r in DEPOSIT_RATES if r["upto_months"] == 12)
    inv_presets = [(f"Вклад на год ({fmt(dep_year)}%)", dep_year), (f"Ключевая ставка ({fmt_num(v['key'])}%)", v["key"])]
    faq_ld = {
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [{"@type": "Question", "name": q,
                        "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq],
    }
    return render_template(
        "index.html",
        team=TEAM, updated=UPDATED, glance=v["glance"],
        people=PEOPLE, invest=v["invest"],
        bars=bars, axis=AXIS, sources=SOURCES,
        regions=region_rows(), russia=RUSSIA_ROW, region_notes=REGION_NOTES,
        scn_defs=SCENARIOS, calendar=calendar_view(), latest_posts=get_posts()[:3], tax=TAX, tax_free_text=f"{TAX['free_base'] * TAX['free_rate'] / 100:,.0f} ₽".replace(",", " "), dep_year_rate=dep_year, bond_rate=BOND_RATE, stock_rate=STOCK_RATE,
        mortgage_presets=MORTGAGE_PRESETS, deposit_rates=DEPOSIT_RATES,
        scenarios=build_scenarios(v["key"], v["next_meeting"]),
        infl_now=fmt(INFLATION), real_rate=fmt(v["key"] - INFLATION),
        decision=LAST_DECISION, faq=faq, faq_ld=faq_ld, site_url=site_url(),
        mortgage_facts=MORTGAGE_FACTS, inv_presets=inv_presets,
        live_note=v["live_note"], asof=v["asof"], scale_sub=v["scale_sub"], dyn_lead=v["dyn_lead"],
        site_data=site_data,
    )


def site_url() -> str:
    """Адрес сайта для canonical и sitemap: переменная SITE_URL или адрес текущего запроса."""
    url = os.environ.get("SITE_URL", "")
    if not url and not os.environ.get("STATIC_BUILD"):   # при статической сборке адреса localhost быть не должно
        try:
            url = request.url_root
        except RuntimeError:
            url = ""
    return url.rstrip("/") + "/" if url else ""


def sw_source(precache: list[str], version: str) -> str:
    """Текст service worker из шаблона static/sw.template.js."""
    src = (BASE / "static" / "sw.template.js").read_text(encoding="utf-8")
    return src.replace("__VERSION__", version).replace("__PRECACHE__", json.dumps(precache))


def asset_version() -> str:
    files = [BASE / "static" / "style.css", BASE / "static" / "app.js", BASE / "templates" / "index.html", BASE / "app.py"]
    return str(int(max(f.stat().st_mtime for f in files)))


FLASK_PRECACHE = ["./", "static/style.css", "static/app.js", "manifest.webmanifest",
                  "icons/icon-192.png", "icons/icon-512.png"]
STATIC_PRECACHE = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"]


@app.route("/manifest.webmanifest")
def manifest():
    return send_from_directory(BASE / "static", "manifest.webmanifest", mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    resp = Response(sw_source(FLASK_PRECACHE, asset_version()), mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/icons/<path:name>")
def icons(name):
    return send_from_directory(BASE / "static" / "icons", name)


GUIDE_DATE = dt.date(2026, 10, 24)    # дата вечных разборов; обновляйте, когда меняете их тексты


def _dep_year_rate():
    return next(r["rate"] for r in DEPOSIT_RATES if r["upto_months"] == 12)


def calendar_view(today: dt.date | None = None):
    """Календарь заседаний: дата, день недели, статус и решение для прошедших."""
    today = today or dt.datetime.now(MSK).date()
    slugs = {p["slug"] for p in get_posts()}
    nxt = next((m for m in MEETINGS if m >= today), None)
    items = []
    for m in MEETINGS:
        iso = m.isoformat()
        dec = MEETING_DECISIONS.get(iso)
        text = None
        if dec:
            old, new = dec
            if new == old:
                text = f"Ставка сохранена на уровне {fmt_num(new)}%"
            else:
                text = f"Ставка {'снижена' if new < old else 'повышена'} с {fmt_num(old)}% до {fmt_num(new)}%"
        slug = f"klyuchevaya-stavka-{m.year}-{m.month:02d}"
        items.append({"iso": iso, "label": f"{m.day} {MONTHS_GEN[m.month - 1]}", "weekday": WEEKDAYS[m.weekday()],
                      "status": "past" if m < today else ("next" if m == nxt else "future"),
                      "decision": text, "post": slug if (dec and dec[0] != dec[1] and slug in slugs) else None})
    return items


def fx_view():
    """Курсы для конвертера: свежие от ЦБ, а без сети запасные."""
    rates = live_data.get_live().get("rates")
    src = rates if rates else FX_FALLBACK
    d = dt.date.fromisoformat(src["date"])
    return {"USD": src["USD"], "EUR": src["EUR"], "CNY": src["CNY"], "RUB": 1.0,
            "date": f"{d.day} {MONTHS_GEN[d.month - 1]} {d.year}", "live": bool(rates)}


def blog_context(now=None):
    v = live_view(now)
    return {
        "key_now": v["key"], "inflation": INFLATION, "deposit_rate": _dep_year_rate(),
        "first_key": KEY_SERIES[0], "mortgage_rate": MORTGAGE_PRESETS[0]["rate"],
        "preferential_rate": MORTGAGE_PRESETS[2]["rate"], "annuity": annuity_payment,
        "deposit_income": deposit_income, "real_gain": real_gain, "tax": TAX,
        "guide_date": GUIDE_DATE.isoformat(), "guide_label": f"{GUIDE_DATE.day} {MONTHS_GEN[GUIDE_DATE.month - 1]} {GUIDE_DATE.year}",
        "fallback_series": KEY_SERIES, "fallback_ym": RATE_YM, "meeting_dates": MEETINGS,
    }


def get_posts():
    return blog.build_posts(live_data.get_live(), blog_context())


def _root(depth):
    """Путь к главной странице: в статической сборке относительный (работает в любой папке), на сервере абсолютный."""
    return "../" * depth if os.environ.get("STATIC_BUILD") else "/"


def _blog_url(path):
    return site_url() + path if site_url() else ""


@app.route("/razbory/")
def razbory_index():
    return render_template("blog.html", posts=get_posts(), news=blog.news_items(live_data.get_live()),
                           team=TEAM, root=_root(1), page_url=_blog_url("razbory/"))


@app.route("/razbory/<slug>/")
def razbory_post(slug):
    posts = get_posts()
    post = next((p for p in posts if p["slug"] == slug), None)
    if post is None:
        return Response("Разбор не найден", status=404)
    url = _blog_url(f"razbory/{slug}/")
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": post["title"],
          "description": post["description"], "datePublished": post["date"], "inLanguage": "ru",
          "author": {"@type": "Organization", "name": TEAM["name"]}}
    if url:
        ld["mainEntityOfPage"] = url
    others = [p for p in posts if p["slug"] != slug][:3]
    return render_template("post.html", post=post, others=others, ld=ld, team=TEAM, root=_root(2), page_url=url)



def _rub_text(x: int) -> str:
    return f"{x:,}".replace(",", "\u00a0") + "\u00a0₽"


def methodology_view(now: dt.datetime | None = None) -> dict:
    """Данные для страницы «Методика и источники»: источники, время обновления, параметры налогов."""
    now = now or dt.datetime.now(MSK)
    status = live_data.get_live().get("status", {})
    owners = {"rates": ("Банк России, курсы валют", live_data.CBR_DAILY_URL),
              "key": ("Банк России, ключевая ставка", live_data.CBR_KEYRATE_PAGE),
              "moex": ("Московская биржа, индексы", "https://iss.moex.com/"),
              "news": ("Банк России, пресс-релизы", live_data.CBR_NEWS_URL)}
    rows = []
    for name, (title, _fn) in live_data.SOURCES.items():
        st = status.get(name, {})
        at = st.get("at")
        if at:
            when = dt.datetime.fromisoformat(at).astimezone(MSK).strftime("%d.%m.%Y, %H:%M МСК")
            if not st.get("ok"):
                when += " (последняя попытка не удалась, показаны прежние данные)"
        else:
            when = "ещё не обновлялось, показаны запасные значения"
        owner, url = owners.get(name, (title, "https://www.cbr.ru/"))
        rows.append({"title": title, "owner": owner, "url": url, "when": when})
    tax = dict(TAX)
    tax.update(free_base_text=_rub_text(TAX["free_base"]), free_rate_text=fmt_num(TAX["free_rate"]),
               threshold_text=_rub_text(TAX["deposit_threshold"]), home_text=_rub_text(TAX["home_limit"]),
               interest_text=_rub_text(TAX["interest_limit"]), iis_text=_rub_text(TAX["iis_limit"]))
    return {"auto_sources": rows, "tax": tax, "built": now.strftime("%d.%m.%Y, %H:%M МСК"),
            "manual_date": UPDATED, "asof": live_view(now)["asof"]}


@app.route("/metodika/")
def metodika():
    ld = {"@context": "https://schema.org", "@type": "WebPage", "name": "Методика и источники", "inLanguage": "ru",
          "publisher": {"@type": "Organization", "name": TEAM["name"]}}
    url = _blog_url("metodika/")
    if url:
        ld["url"] = url
    return render_template("metodika.html", team=TEAM, root=_root(1), page_url=url, ld=ld, sources=SOURCES,
                           scenarios=SCENARIOS, scenario_notes=SCENARIO_NOTES, bond_rate=fmt_num(BOND_RATE),
                           stock_rate=fmt_num(STOCK_RATE), top_text=lambda v: _rub_text(v), **methodology_view())


@app.route("/slovar/")
def slovar():
    terms = sorted(glossary.TERMS, key=lambda t: t[1].lower().replace("ё", "е"))
    letters = []
    for t in terms:
        ch = t[1][0].upper()
        if not letters or letters[-1][0] != ch:
            letters.append((ch, []))
        letters[-1][1].append(t)
    url = _blog_url("slovar/")
    ld = {"@context": "https://schema.org", "@type": "DefinedTermSet", "name": "Словарь терминов: ставки, вклады, ипотека, налоги",
          "inLanguage": "ru", "hasDefinedTerm": [{"@type": "DefinedTerm", "name": t[1], "description": t[2]} for t in terms]}
    if url:
        ld["url"] = url
    return render_template("slovar.html", team=TEAM, root=_root(1), page_url=url, ld=ld, letters=letters, count=len(terms))


SECURITY_TXT = (
    "Contact: mailto:teamgrowth37@gmail.com\n"
    "Expires: 2027-12-31T00:00:00.000Z\n"
    "Preferred-Languages: ru, en\n"
)


@app.route("/.well-known/security.txt")
def security_txt():
    return Response(SECURITY_TXT, mimetype="text/plain")


@app.after_request
def add_security_headers(resp):
    """Заголовки защиты для запуска через Python (на GitHub Pages их заменяет <meta>, см. build_static.py)."""
    return security.apply_headers(resp, secure=request.is_secure)


@app.route("/robots.txt")
def robots():
    lines = ["User-agent: *", "Allow: /"]
    if site_url():
        lines.append(f"Sitemap: {site_url()}sitemap.xml")
    return Response("\n".join(lines) + "\n", mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap():
    today = dt.date.today().isoformat()
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f"  <url><loc>{site_url()}</loc><lastmod>{today}</lastmod></url>\n"
           f"  <url><loc>{site_url()}razbory/</loc><lastmod>{today}</lastmod></url>\n"
           f"  <url><loc>{site_url()}metodika/</loc><lastmod>{today}</lastmod></url>\n"
           f"  <url><loc>{site_url()}slovar/</loc><lastmod>{today}</lastmod></url>\n"
           + "".join(f"  <url><loc>{site_url()}razbory/{p['slug']}/</loc><lastmod>{p['date']}</lastmod></url>\n" for p in get_posts())
           + "</urlset>\n")
    return Response(xml, mimetype="application/xml")


def _free_port(start=5000):
    """Первый свободный порт (на macOS 5000 часто занят системой)."""
    import socket
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


if __name__ == "__main__":
    import threading
    import webbrowser

    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    print("\n  Сайт запущен. Откройте в браузере:  " + url)
    print("  (адрес 0.0.0.0 в браузере не работает, используйте 127.0.0.1 или localhost)")
    print("  Остановить: Ctrl+C\n")
    # свежие данные берём в фоне, чтобы сайт открывался сразу, даже без интернета
    threading.Thread(target=live_data.refresh, daemon=True).start()
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, debug=False)
