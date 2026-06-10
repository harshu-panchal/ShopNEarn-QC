const MOCK_OTP = "1234";

const isMockOtpEnabled = () =>
  process.env.USE_MOCK_OTP === "true" || process.env.USE_MOCK_OTP === "1";

export const useRealSMS = () =>
  !isMockOtpEnabled() &&
  (process.env.USE_REAL_SMS === "true" || process.env.USE_REAL_SMS === "1");

const OTP_LENGTH = Math.max(4, parseInt(process.env.OTP_LENGTH || "4", 10));

function randomOtp(length) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

export const generateOTP = () => {
  if (useRealSMS()) {
    return randomOtp(OTP_LENGTH);
  }

  if (isMockOtpEnabled()) {
    return MOCK_OTP;
  }

  if (process.env.NODE_ENV === "production") {
    const err = new Error("OTP delivery mode is not configured");
    err.statusCode = 500;
    throw err;
  }

  return MOCK_OTP;
};

export { MOCK_OTP };
