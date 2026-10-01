class MicProcessor extends AudioWorkletProcessor {
    constructor () {
        super();
        this._buffer = [];
        // this._chunkSize = 8192; // 8192 samples per chunk
        this._chunkSize = 1024; // 1024 samples per chunk
    }
    process(inputs) {
        const input = inputs[0];
        if (input && input[0]) {
            this._buffer.push(...input[0]);
            while (this._buffer.length >= this._chunkSize) {
                const chunk = this._buffer.slice(0, this._chunkSize);
                this.port.postMessage(chunk);
                this._buffer = this._buffer.slice(this._chunkSize);
            }
        }
        return true;
    }
}

registerProcessor('mic-processor', MicProcessor);