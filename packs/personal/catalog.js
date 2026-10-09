// Pack personal: lists, planners, trackers and timers for everyday life. Default category: personal.
// Data stays in this browser (localStorage) with export/import.
export const cat = 'personal'
export default [
  { id: 'todo-list', name: 'To-do list', module: 'lists', params: { kind: 'todo' }, desc: 'Simple to-dos with due dates and priorities, saved on this device.', icon: 'list-todo', tags: 'todo tasks checklist', ready: true },
  { id: 'grocery-list', name: 'Grocery list', module: 'lists', params: { kind: 'grocery' }, desc: 'Grocery list by aisle with quantities; share it as text.', icon: 'shopping-basket', tags: 'grocery kirana vegetables', ready: true },
  { id: 'shopping-list', name: 'Shopping list', module: 'lists', params: { kind: 'shopping' }, desc: 'Shopping list with prices and a running total.', icon: 'shopping-cart', tags: 'shopping buy', ready: true },
  { id: 'meal-planner', name: 'Meal planner', desc: 'Plan the week of meals and generate the grocery list from it.', icon: 'utensils', tags: 'meal plan weekly menu' },
  { id: 'recipe-scaler', name: 'Recipe scaler', desc: 'Scale recipe ingredients for more or fewer servings, with unit conversion.', icon: 'chef-hat', tags: 'recipe servings scale cooking' },
  { id: 'trip-itinerary', name: 'Trip itinerary planner', desc: 'Plan days, places and bookings; print or share the itinerary.', icon: 'map', tags: 'travel itinerary trip plan' },
  { id: 'packing-list', name: 'Packing list generator', desc: 'A packing list tailored to trip length, weather and activities.', icon: 'luggage', tags: 'packing travel checklist' },
  { id: 'budget-tracker', name: 'Budget tracker', desc: 'Track income and expenses by category with monthly charts.', icon: 'wallet', also: ['calc'], tags: 'budget expenses money tracker' },
  { id: 'expense-splitter', name: 'Group expense splitter', desc: 'Split shared expenses among friends and settle up with fewest payments.', icon: 'users', also: ['calc'], tags: 'splitwise split expenses settle' },
  { id: 'countdown-timer', name: 'Countdown timer', desc: 'Full-screen countdown timer with alarm sound.', icon: 'timer', also: ['screen'], tags: 'timer countdown alarm', ready: true },
  { id: 'stopwatch', name: 'Stopwatch', desc: 'Stopwatch with laps, split times and export.', icon: 'timer-reset', also: ['screen'], tags: 'stopwatch laps', ready: true },
  { id: 'multi-timer', name: 'Multi-timer', desc: 'Run several named timers at once (cooking, workouts, games).', icon: 'alarm-clock', also: ['screen'], tags: 'multiple timers kitchen', ready: true },
  { id: 'pomodoro', name: 'Pomodoro timer', desc: 'Focus sessions and breaks with task tracking and daily stats.', icon: 'clock', also: ['student', 'career'], tags: 'pomodoro focus productivity', ready: true },
  { id: 'habit-tracker', name: 'Habit tracker', desc: 'Track daily habits with streaks and a yearly heatmap.', icon: 'check-check', tags: 'habits streaks daily' },
  { id: 'calendar-planner', name: 'Calendar planner', desc: 'Month planner with events and reminders; export to .ics.', icon: 'calendar', tags: 'calendar events planner ics' },
  { id: 'bmi-calculator', name: 'BMI calculator', desc: 'Body mass index with healthy range, in metric or imperial.', icon: 'heart-pulse', also: ['calc'], tags: 'bmi weight height health' },
  { id: 'calorie-calculator', name: 'Calorie & BMR calculator', desc: 'Daily calories to maintain, lose or gain weight.', icon: 'flame', also: ['calc'], tags: 'calories bmr tdee diet' },
  { id: 'water-intake', name: 'Water intake calculator', desc: 'How much water you should drink per day.', icon: 'droplet', also: ['calc'], tags: 'water hydration' },
  { id: 'random-picker', name: 'Random picker & spin wheel', desc: 'Spin a wheel, pick names, flip a coin or roll dice.', icon: 'dices', tags: 'wheel random choice coin dice' },
  { id: 'gift-planner', name: 'Birthday & gift planner', desc: 'Remember birthdays and anniversaries with gift ideas and budgets.', icon: 'gift', tags: 'birthday anniversary gifts reminders' },
]
