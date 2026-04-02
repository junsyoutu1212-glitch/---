local Icon = require(game.ReplicatedStorage.Icon)
local Frameshop = script.Parent:WaitForChild("Frame")
local Framesong = script.Parent:WaitForChild("MainFrame")
local NewIcon = Icon:new()

NewIcon:setImage("rbxassetid://16723148527"):setLabel("목록")

local function shop()
	Frameshop.Visible = not Frameshop.Visible
end

local function song()
	Framesong.Visible = not Framesong.Visible
end

NewIcon:setDropdown({
	Icon.new():setImage("rbxassetid://18517062196"):setLabel("게임패스"):bindEvent("selected", shop):oneClick(),
	Icon.new():setImage("rbxassetid://10723427081"):setLabel("노래"):bindEvent("selected", song):oneClick(),
	
	Icon.new():setImage("rbxassetid://102886814629150"):setLabel("페이스 제식"):bindEvent("deselected", function()
		local face = script.Parent["페이스 제식"]
		local range = script.Parent["사격장 제식"]
		local obi = script.Parent["오비 제식"]
		face.Visible = true
		range.Visible = false
		obi.Visible = false
	end):oneClick(),
	
	Icon.new():setImage("rbxassetid://102886814629150"):setLabel("사격장 제식"):bindEvent("deselected", function()
		local face = script.Parent["페이스 제식"]
		local range = script.Parent["사격장 제식"]
		local obi = script.Parent["오비 제식"]
		range.Visible = true
		face.Visible = false
		obi.Visible = false
	end):oneClick(),
	
	Icon.new():setImage("rbxassetid://102886814629150"):setLabel("오비 제식"):bindEvent("deselected", function()
		local face = script.Parent["페이스 제식"]
		local range = script.Parent["사격장 제식"]
		local obi = script.Parent["오비 제식"]
		obi.Visible = true
		range.Visible = false
		face.Visible = false
	end):oneClick()
})
