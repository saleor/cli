import detectPort from "detect-port";

export const portIsAvailable = async (
  port: number
): Promise<boolean> => {
  const detectedPort = await detectPort(port).catch((err: Error) => {
    throw new Error(err.message)
  })

  return port == detectedPort
}