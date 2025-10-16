import nodemailer from "nodemailer";

export function makeTransporter({ host, user, pass }) {
  return nodemailer.createTransport({
    host, port: 587, secure: false,
    auth: { user, pass },
  });
}

export async function sendTranscript(transporter, { from, to, subject, text }) {
  await transporter.sendMail({ from, to, subject, text });
}
