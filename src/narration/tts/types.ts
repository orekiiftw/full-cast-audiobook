export interface DeliveryHint {
  pace?: string;
  intensity?: number;
}

export interface TTSProvider {
  speak(
    text: string,
    voiceName: string,
    stylePrompt: string,
    pronunciationDict?: Record<string, string>,
    delivery?: DeliveryHint,
  ): Promise<Buffer>;
}
