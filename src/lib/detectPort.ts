import detectPort from "detect-port";

export const portIsAvailable = async (port: number): Promise<boolean> => {
  const detectedPort = await detectPort(port);

  return port == detectedPort
}

export const checkPort = async (port: number): Promise<void> => {
  if (! await portIsAvailable(port)) {
    throw new Error(`\nSomething is already running at port 3000\nPlease release port 3000 and try again`)
  }
}