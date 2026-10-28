# PD2IH – Dota 2 Inhouse Discord Bot

Zbiorczy bot Discord do różnych funkcji społeczności (dawniej Party Finder).

## Funkcje

### Party Finder (`/party`)
Ogłoszenia "LFG" dla Dota 2.
- Wybór trybu: Ranked, Normal, Battlecup, Low prio.
- Automatyczny wątek dla każdej grupy, powiązany z ogłoszeniem.
- Auto-cleanup: ostrzeżenie po 25 min, wygaśnięcie po 30 min (reset przez "Przedłuż" lub przebywanie na wybranym kanale głosowym).
- Wątki usuwane 24 h po zamknięciu ogłoszenia.

### Oracle (`/podsumowanie`)
Podsumowanie czatu generowane przez Gemini (opcje: liczba dni, kanał, styl, użytkownik). Bot zapisuje wiadomości z kanałów z `ALLOWED_CHANNELS` do lokalnej bazy SQLite (`chat_history.db`).

### Feedback (`/feedback`)
Embed z przyciskiem "Napisz do nas" → formularz (max 1000 znaków). Zgłoszenie trafia na prywatny kanał administratorski jako wątek z oznaczeniem adminów.

## Konfiguracja (`.env`)

| Zmienna | Opis |
| --- | --- |
| `TOKEN`, `CLIENT_ID`, `GUILD_ID` | Dane aplikacji Discord |
| `GEMINI_API_KEY` | Klucz Gemini (Oracle) |
| `ALLOWED_CHANNELS` | ID kanałów śledzonych przez Oracle, po przecinku |
| `GEMINI_MODEL` | Opcjonalnie, domyślnie `gemini-3.5-flash` |
| `FEEDBACK_CHANNEL_ID` | Opcjonalnie, nadpisuje domyślny kanał feedbacku |

Wymagania: Node.js ≥ 22.13 (wbudowany `node:sqlite`) oraz włączony **Message Content Intent** w Developer Portal.
