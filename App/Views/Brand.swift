import SwiftUI

/// The emblem of SportArenaGlobal (the site's logo).
struct BrandLogo: View {
    var size: CGFloat = 40

    var body: some View {
        Image("BrandLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The wave stripes of the site's design (`Ornament.tsx`): three bands of different weight. Decoration only: it fills its parent, which
/// clips it, and never sits behind text or data.
struct Ornament: View {
    enum Tone { case primary, graphite, blush }

    var tone: Tone = .primary
    var bold = false
    /// Drawn entirely inside the box with rounded ends, instead of running off its edges.
    var contained = false

    private var color: Color {
        switch tone {
        case .primary: Theme.primary
        case .graphite: Theme.text
        case .blush: Theme.coral
        }
    }

    var body: some View {
        Canvas { context, size in
            let box = contained ? CGRect(x: 0, y: -50, width: 400, height: 180) : CGRect(x: 0, y: 0, width: 400, height: 120)
            // the site stretches the plain version to its box and keeps the proportions of the contained one
            let sx = size.width / box.width
            let sy = contained ? min(sx, size.height / box.height) : size.height / box.height
            let dx = contained ? (size.width - box.width * sx) / 2 : 0
            let dy = contained ? (size.height - box.height * sy) / 2 : 0
            func point(_ px: CGFloat, _ py: CGFloat) -> CGPoint { CGPoint(x: dx + (px - box.minX) * sx, y: dy + (py - box.minY) * sy) }
            let (x0, x1, xc): (CGFloat, CGFloat, CGFloat) = contained ? (20, 380, 340) : (-20, 440, 380)
            // the three paths of the site's SVG: start y, first curve (two controls, join at x 220), then a smooth curve to the end
            let bands: [(width: CGFloat, start: CGFloat, c1: CGFloat, c2: CGFloat, join: CGFloat, c4: CGFloat, end: CGFloat)] = [
                (26, 90, 40, 140, 60, 20, 70),
                (14, 40, -10, 90, 10, -30, 20),
                (8, 110, 60, 160, 80, 40, 90),
            ]
            for band in bands {
                var path = Path()
                path.move(to: point(x0, band.start))
                path.addCurve(to: point(220, band.join), control1: point(60, band.c1), control2: point(140, band.c2))
                // "S": the first control point mirrors the previous second one about the join
                path.addCurve(to: point(x1, band.end), control1: point(300, 2 * band.join - band.c2), control2: point(xc, band.c4))
                context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: band.width * sx, lineCap: .round))
            }
        }
        .opacity(bold ? 1 : 0.1)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Panels, cards, text

/// A feature panel of the site (the hero of the first screen): the panel colour, a hairline, big corners, and the stripes in the lower
/// right corner behind the text.
struct HeroPanel<Content: View>: View {
    var padding = EdgeInsets(top: 28, leading: 22, bottom: 30, trailing: 22)
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(alignment: .bottomTrailing) {
                GeometryReader { box in
                    Ornament(bold: true, contained: true)
                        .frame(width: box.size.width * 0.44, height: box.size.height * 0.3)
                        .opacity(0.9)
                        .position(x: box.size.width * 0.96 - box.size.width * 0.22, y: box.size.height * 0.94 - box.size.height * 0.15)
                }
            }
            .background(Theme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.panelBorder, lineWidth: 1))
    }
}

extension View {
    /// A card of the site: the surface colour and a hairline.
    func sagCard(padding: CGFloat = 16, radius: CGFloat = Theme.radiusLarge) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
    }

    /// The page: the site's background instead of the system's grey, under lists and forms too. (Not `containerBackground(for: .navigation)`:
    /// with a keyboard up in a sheet it keeps the app from ever becoming idle, and the UI tests wait for ever.)
    func sagScreen() -> some View {
        self.scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
    }
}

/// The small red line over a heading: «ПЛАТФОРМА ДЛЯ ИГРОКОВ И ТРЕНЕРОВ».
struct Kicker: View {
    let text: String
    var color: Color = Theme.primary

    init(_ text: String, color: Color = Theme.primary) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text).font(Theme.display(13, relativeTo: .caption)).tracking(1.6).textCase(.uppercase).foregroundStyle(color)
    }
}

/// A heading of a section: the display face in capitals.
struct SectionTitle: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(Theme.display(22, relativeTo: .title2)).tracking(0.4).textCase(.uppercase).foregroundStyle(Theme.text)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Buttons

/// The site's buttons: capitals in the display face, 8 pt corners; a press shrinks them a little (`:active { scale(0.97) }`).
struct SagButtonStyle: ButtonStyle {
    enum Kind { case primary, ghost, destructive }

    var kind: Kind = .primary
    var fills = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        configuration.label
            .font(Theme.display(17, relativeTo: .headline))
            .tracking(0.7)
            .textCase(.uppercase)
            .foregroundStyle(foreground)
            .frame(maxWidth: fills ? .infinity : nil, minHeight: 50)
            .padding(.horizontal, 22)
            .background(background(pressed: pressed), in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay {
                if kind == .ghost {
                    RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.borderStrong, lineWidth: 1.5)
                }
            }
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(pressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: pressed)
    }

    private var foreground: Color {
        switch kind {
        case .primary: .white
        case .ghost: Theme.text
        case .destructive: Theme.danger
        }
    }

    private func background(pressed: Bool) -> Color {
        switch kind {
        case .primary: pressed ? Theme.primaryPressed : Theme.primary
        case .ghost: Theme.surface
        case .destructive: Theme.dangerTint
        }
    }
}

extension ButtonStyle where Self == SagButtonStyle {
    static var sag: SagButtonStyle { SagButtonStyle() }
    static var sagGhost: SagButtonStyle { SagButtonStyle(kind: .ghost) }
    static var sagDestructive: SagButtonStyle { SagButtonStyle(kind: .destructive) }
}

/// The sun/moon button of the site's top bar: the other theme with one tap.
struct ThemeToggleButton: View {
    @Environment(AppearanceStore.self) private var appearance
    @Environment(\.colorScheme) private var scheme
    /// On a graphite bar (the sign-in screen) the button is light on dark whatever the theme.
    var onDark = false

    var body: some View {
        Button {
            appearance.toggle(from: scheme)
        } label: {
            Image(systemName: scheme == .dark ? "sun.max" : "moon")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(onDark ? Color.white : Theme.text)
                .frame(width: 40, height: 40)
                .background(onDark ? Color.white.opacity(0.08) : Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(onDark ? Color.white.opacity(0.25) : Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(scheme == .dark ? "Светлая тема" : "Тёмная тема")
        .accessibilityIdentifier("theme.toggle")
    }
}

/// A big key number with its caption (the site's `StatTile`): the number in red in the display face, the caption in small capitals.
/// `emphasized` is the dark tile of the site (graphite in the dark theme, the light panel colour in the light one).
struct StatTile: View {
    let value: String
    let label: String
    var emphasized = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(Theme.display(40, weight: .heavy, relativeTo: .largeTitle))
                .monospacedDigit()
                .foregroundStyle(Theme.primary)
                .minimumScaleFactor(0.6).lineLimit(1)
            Text(label)
                .font(Theme.body(11, weight: .bold, relativeTo: .caption2)).tracking(0.55).textCase(.uppercase)
                .foregroundStyle(emphasized ? Theme.panelMuted : Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(emphasized ? Theme.panel : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous)
                .strokeBorder(emphasized ? Theme.panelBorder : Theme.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// The top bar of a main screen, as on the site: the emblem, the name, and the theme switch.
struct AppTopBar<Trailing: View>: View {
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 10) {
            BrandLogo(size: 38)
            Text("SportArenaGlobal")
                .font(Theme.display(16, relativeTo: .headline)).tracking(0.6).textCase(.uppercase).foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            trailing
            ThemeToggleButton()
        }
        .padding(.vertical, 6)
    }
}

extension AppTopBar where Trailing == EmptyView {
    init() { self.init { EmptyView() } }
}

// MARK: - List sections

/// The heading of a list section: small capitals in the display face, as the site's section labels.
struct SagSectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(Theme.display(15, relativeTo: .subheadline)).tracking(0.8).textCase(.uppercase)
            .foregroundStyle(Theme.textSecondary)
    }
}

extension Section where Parent == SagSectionHeader, Footer == EmptyView {
    /// A section titled in the site's style: `Section(sag: "Состав") { … }`.
    init(sag title: String, @ViewBuilder content: () -> Content) {
        self.init(content: content, header: { SagSectionHeader(title: title) })
    }
}

extension Section where Parent == SagSectionHeader, Footer: View {
    init(sag title: String, @ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) {
        self.init(content: content, header: { SagSectionHeader(title: title) }, footer: footer)
    }
}

// MARK: - Main screens

extension View {
    /// The bar of a main screen: the emblem on the left, the title in capitals in the middle, the screen's own buttons on the right.
    func sagMainBar(_ title: String) -> some View {
        self
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .sagScreen()
            .toolbar {
                BarLogo()
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .font(Theme.display(20, weight: .heavy, relativeTo: .headline)).tracking(0.6).textCase(.uppercase)
                        .foregroundStyle(Theme.text)
                        .accessibilityHidden(true)
                }
            }
    }
}

/// A team's mark: its first letter in the display face on the red wash (the site's `.teamAvatar`).
struct TeamAvatar: View {
    let name: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.26, style: .continuous).fill(Theme.primaryTint)
            Text(String(name.prefix(1)).uppercased())
                .font(Theme.display(size * 0.48, weight: .heavy, relativeTo: .title2)).foregroundStyle(Theme.primary)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The emblem sits in the bar as a picture, not as a button: no glass pill around it (iOS 26 and later draw one around bar items).
private struct BarLogo: ToolbarContent {
    var body: some ToolbarContent {
        if #available(iOS 26.0, *) {
            ToolbarItem(placement: .topBarLeading) { BrandLogo(size: 32) }.sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .topBarLeading) { BrandLogo(size: 32) }
        }
    }
}
