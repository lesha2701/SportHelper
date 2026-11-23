-- 0059: блог (статьи тренеров и игроков). Только добавляет: таблицы блога, три колонки у пользователей,
-- две новые цели жалоб (статья, комментарий), причину «Реклама» и две категории уведомлений.
-- Применять только после 0056–0058 (подбор тренера): раннер пропускает патчи с меньшим номером.

CREATE TABLE IF NOT EXISTS posts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sport          TEXT NOT NULL CHECK (char_length(sport) BETWEEN 1 AND 60),
    title          TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
    -- Блоки текста: [{"type": "paragraph|heading|quote", "text": "..."}, {"type": "list", "items": ["..."]}], в тексте только **жирный** и *курсив*.
    body           JSONB NOT NULL,
    -- Тот же текст без разметки: для проверки длины и для поиска.
    body_text      TEXT NOT NULL,
    -- draft: черновик; pending: ждёт администратора; published: видна всем; rejected: отклонена (причина в reject_reason); removed: снята администратором.
    status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'rejected', 'removed')),
    -- Что отметила автопроверка для администратора (например «promo_words»); пусто — чисто.
    flags          TEXT[] NOT NULL DEFAULT '{}',
    reject_reason  TEXT CHECK (reject_reason IS NULL OR char_length(reject_reason) BETWEEN 1 AND 500),
    -- Объявление тренера, карточка которого показана под статьёй. SET NULL: удаление объявления не должно ломать статью.
    listing_id     UUID REFERENCES coach_listings(id) ON DELETE SET NULL,
    submitted_at   TIMESTAMPTZ,
    published_at   TIMESTAMPTZ,
    reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at    TIMESTAMPTZ,
    likes_count    INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
    comments_count INTEGER NOT NULL DEFAULT 0 CHECK (comments_count >= 0),
    views_count    INTEGER NOT NULL DEFAULT 0 CHECK (views_count >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_feed_idx ON posts (published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_feed_sport_idx ON posts (sport, published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_pending_idx ON posts (submitted_at) WHERE status = 'pending' AND deleted_at IS NULL;

-- Фото статьи (до трёх; порядок — position). Сами файлы лежат в files (PUBLIC, как фото объявлений).
CREATE TABLE IF NOT EXISTS post_images (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id  UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    file_id  UUID NOT NULL REFERENCES files(id),
    position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 2),
    UNIQUE (post_id, position),
    UNIQUE (file_id)
);

CREATE TABLE IF NOT EXISTS post_likes (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    -- Контакты в комментарии закрыты, а не отклонены: так человек видит, что именно скрыто.
    contact_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    -- Снят администратором по жалобе.
    hidden_at  TIMESTAMPTZ,
    hidden_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    hidden_reason TEXT CHECK (hidden_reason IS NULL OR char_length(hidden_reason) BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS post_comments_post_idx ON post_comments (post_id, created_at) WHERE deleted_at IS NULL;

-- Просмотр засчитывается вошедшему человеку один раз в сутки; гости и автор не считаются.
CREATE TABLE IF NOT EXISTS post_views (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     DATE NOT NULL,
    PRIMARY KEY (post_id, user_id, day)
);

CREATE TABLE IF NOT EXISTS post_bookmarks (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS post_bookmarks_user_idx ON post_bookmarks (user_id, created_at DESC);

-- «Скрыть статью» и «Скрыть автора»: только для самого читателя.
CREATE TABLE IF NOT EXISTS post_hides (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS post_author_mutes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, author_id),
    CHECK (user_id <> author_id)
);

-- Настройки пользователя: открыт ли профиль игрока из статей; «доверенный автор» (его статьи публикуются после автопроверки, без ручной).
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_profile_in_posts BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS posts_trusted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS posts_trusted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Жалобы на статью и комментарий; причина «Реклама».
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_target_type_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_target_type_check
    CHECK (target_type IN ('user', 'listing', 'media', 'post', 'post_comment'));
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_reason_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_reason_check
    CHECK (reason IN ('inappropriate', 'fraud', 'spam', 'false_info', 'advertising', 'other'));

-- Уведомления автору: результат проверки статьи и новый комментарий (служебные, без переключателя).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested', 'training_nudge',
                        'payment_update', 'earning_update', 'withdrawal_update', 'finance_admin',
                        'chat_booking', 'chat_team', 'match_offer', 'match_offer_reply',
                        'post_review', 'post_comment'));
