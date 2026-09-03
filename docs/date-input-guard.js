(() => {
  const stopInvalidDate = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "date") return;
    const invalid = !input.value
      || (input.min && input.value < input.min)
      || (input.max && input.value > input.max);
    if (invalid) event.stopImmediatePropagation();
  };

  document.addEventListener("input", stopInvalidDate, true);
  document.addEventListener("change", stopInvalidDate, true);
})();
