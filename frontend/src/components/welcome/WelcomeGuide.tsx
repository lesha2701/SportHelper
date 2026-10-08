import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../shared/Icon";
import styles from "./welcome.module.css";

export type WelcomeResult = "completed" | "skipped";

interface WelcomeGuideProps {
  /** Opened by hand from «Помощь»: no "skip", closing never touches the account. */
  manual?: boolean;
  /** Roles the user already has, to mark them on the last screen. */
  roles?: { player: boolean; coach: boolean };
  onFinish: (result: WelcomeResult) => void;
}

interface Tile {
  icon: IconName;
  label: string;
}

function Tiles({ items }: { items: Tile[] }) {
  return (
    <>
      {items.map((t) => (
        <div key={t.label} className={styles.tile}>
          <span className={styles.tileIcon}>
            <Icon name={t.icon} size={20} />
          </span>
          <span className={styles.tileLabel}>{t.label}</span>
        </div>
      ))}
    </>
  );
}

function Flow({ items }: { items: Tile[] }) {
  return (
    <div className={styles.flow}>
      {items.map((t, i) => (
        <div key={t.label} className={styles.flowStep}>
          <div className={styles.flowCard}>
            <span className={styles.tileIcon}>
              <Icon name={t.icon} size={20} />
            </span>
            <span className={styles.tileLabel}>{t.label}</span>
          </div>
          {/* The last card keeps an (invisible) arrow slot so all cards are the same width. */}
          <span className={styles.flowArrow} aria-hidden="true" style={i < items.length - 1 ? undefined : { visibility: "hidden" }}>
            <Icon name="chevron-right" size={12} />
          </span>
        </div>
      ))}
    </div>
  );
}

interface Step {
  id: string;
  /** Who the step is for: shown above the title. */
  kicker?: string;
  title: string;
  lead: string;
  /** Short concrete points — what you can actually do. */
  points?: string[];
  extra?: string;
  visual: (props: Pick<WelcomeGuideProps, "roles">) => ReactNode;
}

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Добро пожаловать в SportArena",
    lead: "Всё для вашей спортивной жизни в одном месте.",
    extra: "Управляйте командой, тренировками и прогрессом или находите личного тренера и записывайтесь на занятия. Дальше — коротко о том, что здесь есть.",
    visual: () => (
      <div className={styles.hero}>
        <div className={styles.heroMark}>SA</div>
        <div className={styles.heroChips}>
          <Tiles items={[{ icon: "users", label: "Команда" }, { icon: "dumbbell", label: "Тренировки" }, { icon: "calendar", label: "Календарь" }]} />
        </div>
      </div>
    ),
  },
  {
    id: "everything",
    kicker: "Для всех",
    title: "Всё важное — в одном месте",
    lead: "Тренировки, матчи, задания и личные занятия собираются в одном приложении.",
    extra: "Все важные события появляются в календаре и связаны со статистикой.",
    visual: () => (
      <div className={styles.bento}>
        <Tiles
          items={[
            { icon: "trophy", label: "Команды" },
            { icon: "dumbbell", label: "Тренировки" },
            { icon: "ball", label: "Матчи" },
            { icon: "clipboard", label: "Задания" },
          ]}
        />
        <div className={`${styles.tile} ${styles.tileWide} ${styles.tileAccent}`}>
          <span className={styles.tileIcon}>
            <Icon name="calendar" size={20} />
          </span>
          <span className={styles.tileLabel}>Календарь</span>
          <span className={styles.tileTag}>
            <Icon name="award" size={13} />
            Статистика
          </span>
        </div>
      </div>
    ),
  },
  {
    id: "player",
    kicker: "Игроку",
    title: "Ваша команда и ваш прогресс",
    lead: "Следите за тренировками и матчами, выполняйте задания тренера и отслеживайте свой прогресс.",
    points: [
      "Календарь собирает тренировки, матчи и дедлайны заданий по всем вашим командам.",
      "Посещаемость, серия тренировок и выполненные задания складываются в вашу статистику.",
      "В команду можно вступить по ссылке-приглашению от тренера.",
      "Уведомления в Telegram и в приложении не дадут пропустить важное.",
    ],
    visual: () => (
      <div className={styles.bento}>
        <Tiles items={[{ icon: "calendar", label: "Тренировки и матчи" }, { icon: "clipboard", label: "Задания тренера" }, { icon: "award", label: "Мой прогресс" }, { icon: "bell", label: "Уведомления" }]} />
      </div>
    ),
  },
  {
    id: "solo",
    kicker: "Игроку",
    title: "Личные тренировки — для себя",
    lead: "Тренироваться можно и без команды: создайте личную тренировку и ведите её сами.",
    points: [
      "Соберите список упражнений: с повторениями и подходами.",
      "Или выберите круговую тренировку: задайте число кругов и отдых между ними.",
      "«Начать тренировку» включает пошаговый режим с таймером.",
      "Можно задать время, напоминание и повтор по неделям; ИИ предложит готовый план.",
      "После занятия отметьте самочувствие — ИИ оценит тренировку.",
    ],
    visual: () => (
      <Flow items={[{ icon: "dumbbell", label: "Список" }, { icon: "clock", label: "Таймер" }, { icon: "check-circle", label: "Готово" }, { icon: "award", label: "Прогресс" }]} />
    ),
  },
  {
    id: "coach-team",
    kicker: "Тренеру",
    title: "Гибкое управление командой",
    lead: "Создавайте команды и ведите их так, как удобно вам.",
    points: [
      "Роли: основной тренер, помощник, капитан, игрок — у каждой свои права.",
      "Приглашайте игроков по ссылке и принимайте заявки на вступление.",
      "Тренировки — одиночные или серией по неделям; отмечайте посещаемость.",
      "Матчи: состав, результат и история. Статистика команды покажет, кто пропускает и кто просел.",
    ],
    visual: () => (
      <div className={styles.bento}>
        <Tiles items={[{ icon: "users", label: "Состав и роли" }, { icon: "dumbbell", label: "Тренировки" }, { icon: "check-circle", label: "Посещения" }, { icon: "ball", label: "Матчи" }]} />
      </div>
    ),
  },
  {
    id: "library",
    kicker: "Тренеру",
    title: "Библиотека упражнений",
    lead: "Один раз опишите упражнение — и используйте его везде.",
    points: [
      "Упражнение: описание, цель, подходы и повторения, техника, типичные ошибки, фото и видео.",
      "План: соберите упражнения в разминку, основную часть и заминку.",
      "Привяжите план к тренировке — игроки увидят его прямо в занятии.",
      "Упражнения и шаблоны заданий доступны во всех ваших командах.",
    ],
    visual: () => (
      <Flow items={[{ icon: "dumbbell", label: "Упражнение" }, { icon: "book", label: "План" }, { icon: "calendar", label: "Тренировка" }, { icon: "clipboard", label: "Задание" }]} />
    ),
  },
  {
    id: "tasks",
    kicker: "Тренеру и игроку",
    title: "Задания и отчёты",
    lead: "Тренер ставит задачи, игрок выполняет их и отчитывается — всё в приложении.",
    points: [
      "Задание можно дать всей команде, выбранным игрокам, игрокам одной позиции или тем, кто пропустил тренировку.",
      "Тренер задаёт дедлайн и что нужно в отчёте: комментарий, фото, видео, подходы, показатель.",
      "Игрок берёт задание в работу и отправляет отчёт.",
      "Тренер принимает его или возвращает на доработку с комментарием.",
    ],
    visual: () => (
      <Flow items={[{ icon: "clipboard", label: "Задание" }, { icon: "image", label: "Отчёт" }, { icon: "check-circle", label: "Проверка" }, { icon: "award", label: "Прогресс" }]} />
    ),
  },
  {
    id: "personal",
    kicker: "Игроку",
    title: "Личный тренер",
    lead: "Найдите подходящего тренера, выберите свободное время и отправьте заявку на тренировку.",
    points: [
      "В разделе «Тренеры» фильтруйте по городу, цене, рейтингу и формату — онлайн или очно.",
      "В профиле тренера: опыт, достижения, объявления и отзывы других игроков.",
      "После подтверждения занятие автоматически появится в вашем календаре.",
      "После занятия можно оставить отзыв о тренере.",
    ],
    visual: () => (
      <div className={styles.stack}>
        <Flow items={[{ icon: "user", label: "Тренер" }, { icon: "clock", label: "Время" }, { icon: "inbox", label: "Заявка" }, { icon: "dumbbell", label: "Тренировка" }]} />
      </div>
    ),
  },
  {
    id: "coach-market",
    kicker: "Тренеру",
    title: "Свои занятия с игроками",
    lead: "Тренер может вести и личные занятия: опубликовать объявление и принимать записи.",
    points: [
      "Объявление: цена, формат, фото, видео и недельное расписание.",
      "Заявки: подтверждайте или отклоняйте, смотрите профиль игрока и отзывы других тренеров.",
      "После занятия нажмите «Тренировка проведена» и оставьте отзыв об игроке.",
      "С разрешения игрока ИИ подготовит анализ перед занятием.",
    ],
    visual: () => (
      <div className={styles.stack}>
        <Flow items={[{ icon: "edit", label: "Объявление" }, { icon: "inbox", label: "Заявка" }, { icon: "dumbbell", label: "Занятие" }, { icon: "award", label: "Отзыв" }]} />
        <div className={styles.aiBadge}>
          <Icon name="sparkles" size={16} />
          AI-анализ игрока
        </div>
      </div>
    ),
  },
  {
    id: "ai",
    kicker: "Для всех",
    title: "ИИ и уведомления",
    lead: "ИИ подсказывает, а уведомления возвращают вас к нужному в нужный момент.",
    points: [
      "ИИ: черновик плана и заданий, оценка тренировки, рекомендации игроку, сводка по команде.",
      "Это подсказки — решение всегда за вами.",
      "Уведомления приходят в бота и в колокольчик; кнопка ведёт сразу на нужный экран.",
      "Что получать — настраивается в «Профиль → Настройки». Быстрый поиск — по ⌘K.",
    ],
    visual: () => (
      <div className={styles.stack}>
        <div className={styles.aiBadge}>
          <Icon name="sparkles" size={16} />
          AI-помощник
        </div>
        <div className={styles.bento}>
          <Tiles items={[{ icon: "bell", label: "Уведомления" }, { icon: "search", label: "Поиск" }]} />
        </div>
      </div>
    ),
  },
  {
    id: "roles",
    kicker: "Для всех",
    title: "Используйте SportArena так, как удобно вам",
    lead: "Вы можете быть игроком, тренером или совмещать обе роли.",
    extra: "Между режимами можно переключаться в любой момент. Это знакомство всегда можно открыть снова: «Профиль → Помощь» или «Настройки».",
    visual: ({ roles }) => (
      <div className={styles.roles}>
        <div className={styles.roleCard}>
          <span className={styles.tileIcon}>
            <Icon name="ball" size={22} />
          </span>
          <span className={styles.tileLabel}>Игрок</span>
          {roles?.player && <span className={styles.roleOwned}>Ваша роль</span>}
        </div>
        <span className={styles.roleSwitch} aria-hidden="true">
          ⇄
        </span>
        <div className={styles.roleCard}>
          <span className={styles.tileIcon}>
            <Icon name="clipboard" size={22} />
          </span>
          <span className={styles.tileLabel}>Тренер</span>
          {roles?.coach && <span className={styles.roleOwned}>Ваша роль</span>}
        </div>
      </div>
    ),
  },
];

export const WELCOME_STEP_COUNT = STEPS.length;

/** Short, skippable welcome flow. A self-contained overlay — it never points at
 * real UI elements, so interface changes can't break it. Escape does NOT close
 * it (that would be an accidental skip); only the visible buttons do. */
export function WelcomeGuide({ manual = false, roles, onFinish }: WelcomeGuideProps) {
  const [index, setIndex] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const last = index === STEPS.length - 1;
  const step = STEPS[index]!;

  const next = () => setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setIndex((i) => Math.max(i - 1, 0));

  // Move focus to the new step's heading so keyboard and screen-reader users
  // land on the content, not on a button that just changed its meaning.
  useEffect(() => {
    titleRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, STEPS.length - 1));
      else if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const primaryLabel = index === 0 ? "Начать знакомство" : last ? (manual ? "Готово" : "Перейти в SportArena") : "Далее";

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className={styles.topRow}>
          <ol className={styles.dots} aria-label={`Шаг ${index + 1} из ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                className={i === index ? `${styles.dot} ${styles.dotActive}` : i < index ? `${styles.dot} ${styles.dotDone}` : styles.dot}
                aria-current={i === index ? "step" : undefined}
              />
            ))}
          </ol>
          {manual ? (
            <button type="button" className={styles.skip} onClick={() => onFinish("completed")} aria-label="Закрыть">
              <Icon name="x" size={18} />
            </button>
          ) : (
            <button type="button" className={styles.skip} onClick={() => onFinish("skipped")}>
              Пропустить
            </button>
          )}
        </div>

        <div className={styles.body} key={step.id}>
          <div className={styles.visual}>{step.visual({ roles })}</div>
          {step.kicker && <span className={styles.kicker}>{step.kicker}</span>}
          <h1 id="welcome-title" className={styles.title} ref={titleRef} tabIndex={-1}>
            {step.title}
          </h1>
          <p className={styles.lead}>{step.lead}</p>
          {step.points && (
            <ul className={styles.points}>
              {step.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}
          {step.extra && <p className={styles.extra}>{step.extra}</p>}
        </div>

        <div className={styles.actions}>
          {index > 0 && (
            <button type="button" className={styles.back} onClick={back}>
              Назад
            </button>
          )}
          <button type="button" className={styles.primary} onClick={last ? () => onFinish("completed") : next}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
