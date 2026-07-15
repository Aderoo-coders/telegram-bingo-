import { Keyboard } from 'grammy';

export function mainMenu() {
  return new Keyboard()
    .text("🎮 Play Bingo").text("💰 Deposit").row()
    .text("💵 Balance").text("💸 Withdraw").text("📜 Transactions")
    .resized();
}
