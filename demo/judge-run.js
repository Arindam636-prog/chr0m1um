const fare = document.querySelector('#fare');
const prepare = document.querySelector('#prepare');
const done = document.querySelector('#done');
prepare.addEventListener('click', () => {
  if (!fare.value) {
    done.textContent = 'Choose a fare first.';
    done.hidden = false;
    return;
  }
  done.textContent = `Ticket prepared: ${fare.value}. Demo complete. No purchase was made.`;
  done.hidden = false;
  prepare.disabled = true;
});
