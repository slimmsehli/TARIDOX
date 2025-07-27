// utils/codeGenerator.js

/**
 * Generates a random 4-digit numeric code.
 * @returns {string} A 4-digit string.
 */
function generate4DigitCode() {
    // Generate a random number between 1000 and 9999
    return Math.floor(1000 + Math.random() * 9000).toString();
}

module.exports = {
    generate4DigitCode
};

