import { discoverDevices } from "../lib/ring/client";
import { db, BUSINESS_ID } from "../lib/db";
import { AppError } from "../lib/errors";
async function main() {
  try {
    const result = await discoverDevices();
    const message = `Verified GET /v1/devices (HTTP ${result.httpStatus}); ${result.devices.length} devices returned.`;
    await db.integrationCheck.create({
      data: {
        businessId: BUSINESS_ID,
        endpoint: "GET /v1/devices",
        status: result.httpStatus,
        success: true,
        message,
      },
    });
    console.log(
      JSON.stringify(
        {
          verified: true,
          endpoint: "GET /v1/devices",
          httpStatus: result.httpStatus,
          deviceCount: result.devices.length,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          verified: false,
          endpoint: "GET /v1/devices",
          reason:
            error instanceof AppError
              ? error.message
              : "Connection verification failed.",
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
void main();
