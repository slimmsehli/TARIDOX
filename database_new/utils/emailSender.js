// utils/emailSender.js

/**
 * Simulates sending an email. In a real application, this would integrate with an email service.
 * @param {string} to - Recipient email address.
 * @param {string} subject - Email subject.
 * @param {string} text - Email plain text content.
 * @param {string} html - Email HTML content (optional).
 */
async function sendEmail(to, subject, text, html) {
    console.log(`\n--- SIMULATED EMAIL SEND ---`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Text Body: ${text}`);
    if (html) {
        console.log(`HTML Body (truncated): ${html.substring(0, 100)}...`);
    }
    console.log(`----------------------------\n`);
    // In a real app, you'd use a library like Nodemailer here:
    /*
    const nodemailer = require('nodemailer');
    let transporter = nodemailer.createTransport({
        service: 'gmail', // or your SMTP host
        auth: {
            user: 'your_email@example.com',
            pass: 'your_email_password'
        }
    });
    let info = await transporter.sendMail({
        from: '"Smart Locker System" <your_email@example.com>',
        to: to,
        subject: subject,
        text: text,
        html: html
    });
    console.log("Message sent: %s", info.messageId);
    */
}

module.exports = {
    sendEmail
};

