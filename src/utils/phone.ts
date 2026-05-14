/**
 * Utility for formatting and validating phone numbers.
 * Validates Zambian phone numbers and formats them to E.164 standard (+260...).
 * 
 * Zambian phone numbers must be 9 digits long after the country code.
 * Valid prefixes: 097, 096, 095, 077, 076, 075
 */

export function validateAndFormatZambianPhone(phone: string): { isValid: boolean; formatted: string } {
  if (!phone) return { isValid: false, formatted: '' };

  // Remove all non-numeric characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');

  // Zambian mobile networks: Airtel (97, 77), MTN (96, 76), Zamtel (95, 75)
  // Format can be +26097..., 26097..., 097..., or just 97...
  const zmRegex = /^(?:\+?260|0)?([79][567]\d{7})$/;
  const match = cleaned.match(zmRegex);

  if (match) {
    return {
      isValid: true,
      formatted: `+260${match[1]}`
    };
  }

  return {
    isValid: false,
    formatted: phone
  };
}
