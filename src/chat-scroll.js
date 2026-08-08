(function exposeChatScrollController(globalObject) {
  class ChatScrollController {
    constructor(list, indicator, options = {}) {
      this.list = list;
      this.indicator = indicator;
      this.threshold = options.threshold ?? 90;
      this.requestFrame = options.requestFrame || globalObject.requestAnimationFrame.bind(globalObject);
      this.renderToken = 0;
      this.forceNext = true;
      this.pendingStick = false;
    }

    beforeRender({ friendChanged = false, newMessageArrived = false } = {}) {
      const distance = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight;
      const shouldStick = this.forceNext || this.pendingStick || friendChanged || distance < this.threshold;
      if (shouldStick) this.pendingStick = true;
      this.forceNext = false;
      return {
        shouldStick,
        newMessageArrived,
        previousTop: this.list.scrollTop
      };
    }

    afterRender(snapshot) {
      const token = ++this.renderToken;
      this.requestFrame(() => {
        if (token !== this.renderToken) return;
        if (snapshot.shouldStick || this.pendingStick) {
          this.list.scrollTop = this.list.scrollHeight;
          this.indicator.classList.add("hidden");
          this.requestFrame(() => {
            if (token !== this.renderToken) return;
            this.list.scrollTop = this.list.scrollHeight;
            this.pendingStick = false;
          });
          return;
        }
        this.list.scrollTop = snapshot.previousTop;
        this.indicator.classList.toggle("hidden", !snapshot.newMessageArrived);
      });
    }

    forceBottom() {
      this.forceNext = true;
      this.pendingStick = true;
    }

    handleScroll() {
      const distance = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight;
      if (distance < this.threshold) this.indicator.classList.add("hidden");
    }

    scrollToBottom(behavior = "smooth") {
      this.forceBottom();
      this.list.scrollTo({ top: this.list.scrollHeight, behavior });
      this.indicator.classList.add("hidden");
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { ChatScrollController };
  if (globalObject) globalObject.ChatScrollController = ChatScrollController;
})(typeof window !== "undefined" ? window : globalThis);
